import { readFileSync } from "node:fs";
import { type DataContract, dataContract, type QuerySpec, querySpec } from "@adam-riffi/dash-core";
import { describe, expect, it } from "vitest";
import { planJoins } from "../../src/query/paths.ts";
import { type ValidQuery, validateQuery } from "../../src/query/validate.ts";

const fixture = (name: string) =>
  dataContract.parse(
    JSON.parse(
      readFileSync(
        new URL(`../integration/fixtures/${name}.contract.json`, import.meta.url),
        "utf8",
      ),
    ),
  );
const demo = fixture("dash_demo");
const graph = fixture("graph");

/** Validates a spec first, the way the gateway will, so the planner sees resolved fields. */
function valid(contract: DataContract, spec: Partial<QuerySpec> & Pick<QuerySpec, "measures">) {
  const result = validateQuery(querySpec.parse(spec), contract);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.query as ValidQuery;
}
const describeJoins = (contract: DataContract, query: ValidQuery) => {
  const result = planJoins(query, contract);
  return result.ok
    ? {
        base: result.plan.base,
        joins: result.plan.joins.map(
          (j) => `${j.from.table}(${j.from.columns}) -> ${j.to.table}(${j.to.columns})`,
        ),
      }
    : { errors: result.errors };
};

const units = { field: "dash_demo.order_items.quantity" };

describe("planJoins", () => {
  it("needs no join when everything is on the base table", () => {
    expect(describeJoins(demo, valid(demo, { measures: [units] }))).toEqual({
      base: "dash_demo.order_items",
      joins: [],
    });
  });

  it("follows many-to-one relationships, nearest tables first", () => {
    const query = valid(demo, {
      dimensions: [
        { field: "dash_demo.customers.segment" },
        { field: "dash_demo.products.category" },
      ],
      measures: [units],
      filters: [{ field: "dash_demo.orders.status", op: "in", values: ["paid"] }],
    });
    expect(describeJoins(demo, query)).toEqual({
      base: "dash_demo.order_items",
      joins: [
        "dash_demo.order_items(order_id) -> dash_demo.orders(id)",
        "dash_demo.order_items(product_id) -> dash_demo.products(id)",
        "dash_demo.orders(customer_id) -> dash_demo.customers(id)",
      ],
    });
  });

  it("keeps composite keys together", () => {
    const query = valid(graph, {
      dimensions: [{ field: "fx_graph.flights.departs_at", timeGrain: "day" }],
      measures: [{ field: "fx_graph.legs.duration_minutes" }],
    });
    expect(describeJoins(graph, query)).toEqual({
      base: "fx_graph.legs",
      joins: ["fx_graph.legs(carrier,number) -> fx_graph.flights(carrier,number)"],
    });
  });

  it("rejects measures from more than one table", () => {
    const query = valid(demo, {
      measures: [units, { field: "dash_demo.products.unit_price" }],
    });
    expect(describeJoins(demo, query)).toEqual({
      errors: [
        "measures come from dash_demo.order_items and dash_demo.products; a query has one fact table",
      ],
    });
  });

  it("rejects ambiguous paths and names both relationships", () => {
    const query = valid(graph, {
      dimensions: [{ field: "fx_graph.airports.city" }],
      measures: [{ field: "fx_graph.legs.duration_minutes" }],
    });
    expect(describeJoins(graph, query)).toEqual({
      errors: [
        "fx_graph.airports: two equally short paths from fx_graph.legs (via fx_graph.flights(destination), via fx_graph.flights(origin)); the join is ambiguous",
      ],
    });
  });

  it("rejects fan-out: tables only reachable through one-to-many relationships", () => {
    const query = valid(demo, {
      dimensions: [{ field: "dash_demo.products.category" }],
      measures: [{ field: "dash_demo.orders.id", aggregation: "COUNT" }],
    });
    expect(describeJoins(demo, query)).toEqual({
      errors: [
        "dash_demo.products: reachable from dash_demo.orders only through one-to-many relationships (fan-out would repeat rows)",
      ],
    });
  });

  it("rejects tables with no relationship to the base", () => {
    const query = valid(graph, {
      dimensions: [{ field: "fx_graph.audit.note" }],
      measures: [{ field: "fx_graph.legs.duration_minutes" }],
    });
    expect(describeJoins(graph, query)).toEqual({
      errors: ["fx_graph.audit: not related to fx_graph.legs"],
    });
  });

  it("joins a self-referencing table once, as itself", () => {
    const query = valid(graph, {
      dimensions: [{ field: "fx_graph.employees.name" }],
      measures: [{ field: "fx_graph.employees.id", aggregation: "COUNT" }],
    });
    expect(describeJoins(graph, query)).toEqual({ base: "fx_graph.employees", joins: [] });
  });
});
