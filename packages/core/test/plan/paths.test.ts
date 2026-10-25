import { readFileSync } from "node:fs";
import { type DataContract, dataContract, type QuerySpec, querySpec } from "@adam-riffi/dash-core";
import { describe, expect, it } from "vitest";
import { planJoins } from "../../src/plan/paths.ts";
import { type ValidQuery, validateQuery } from "../../src/plan/validate.ts";

const fixture = (name: string) =>
  dataContract.parse(
    JSON.parse(
      readFileSync(
        new URL(
          `../../../gateway/test/integration/fixtures/${name}.contract.json`,
          import.meta.url,
        ),
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

/** A plan's facts (ADR 0014): one per fact table, each with its joins; a single fact has none. */
const describeFacts = (contract: DataContract, query: ValidQuery) => {
  const result = planJoins(query, contract);
  return result.ok
    ? (result.plan.facts ?? []).map((f) => ({
        base: f.base,
        joins: f.joins.map((j) => `${j.from.table}(${j.from.columns}) -> ${j.to.table}`),
      }))
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

  it("plans a looked-up table's repeating measure on its own table instead (ADR 0014)", () => {
    // ADR 0007 refused it; each fact now answers at its own grain.
    const query = valid(demo, {
      measures: [units, { field: "dash_demo.products.unit_price" }],
    });
    expect(describeFacts(demo, query)).toEqual([
      { base: "dash_demo.order_items", joins: [] },
      { base: "dash_demo.products", joins: [] },
    ]);
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

  it("treats duplicate foreign key constraints as one relationship", () => {
    const [first] = demo.relationships;
    const doubled = { ...demo, relationships: [...demo.relationships, structuredClone(first)] };
    const query = valid(demo, {
      dimensions: [{ field: "dash_demo.orders.status" }],
      measures: [units],
    });
    expect(describeJoins(doubled as DataContract, query)).toEqual({
      base: "dash_demo.order_items",
      joins: ["dash_demo.order_items(order_id) -> dash_demo.orders(id)"],
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

describe("fact tables of formula measures", () => {
  const formulas = (...list: string[]) =>
    valid(demo, { measures: list.map((formula) => ({ formula })) });

  it("looks up many-to-one tables from the measure's fact table", () => {
    expect(
      describeJoins(demo, formulas("SUM(order_items.quantity * products.unit_price)")),
    ).toEqual({
      base: "dash_demo.order_items",
      joins: ["dash_demo.order_items(product_id) -> dash_demo.products(id)"],
    });
  });

  it("lets duplicate-insensitive aggregates read the one side", () => {
    expect(
      describeJoins(demo, formulas("SUM(order_items.quantity) / COUNTDISTINCT(orders.id)")),
    ).toEqual({
      base: "dash_demo.order_items",
      joins: ["dash_demo.order_items(order_id) -> dash_demo.orders(id)"],
    });
  });

  it("counts the one side on its own table, inside one formula (ADR 0014)", () => {
    expect(describeFacts(demo, formulas("SUM(order_items.quantity) / COUNT(orders.id)"))).toEqual([
      { base: "dash_demo.order_items", joins: [] },
      { base: "dash_demo.orders", joins: [] },
    ]);
  });

  it("counts the one side on its own table, across measures (ADR 0014)", () => {
    expect(describeFacts(demo, formulas("SUM(order_items.quantity)", "COUNT(orders.id)"))).toEqual([
      { base: "dash_demo.order_items", joins: [] },
      { base: "dash_demo.orders", joins: [] },
    ]);
  });

  it("lets measures over different tables share the fact table that reaches them", () => {
    const query = valid(demo, {
      dimensions: [{ field: "dash_demo.products.category" }],
      measures: [
        { formula: "SUM(order_items.quantity * products.unit_price)" },
        { formula: "COUNTDISTINCT(orders.customer_id)" },
      ],
    });
    expect(describeJoins(demo, query)).toEqual({
      base: "dash_demo.order_items",
      joins: [
        "dash_demo.order_items(order_id) -> dash_demo.orders(id)",
        "dash_demo.order_items(product_id) -> dash_demo.products(id)",
      ],
    });
  });

  it("plans measures from tables that don't reach each other per fact (ADR 0014)", () => {
    expect(
      describeFacts(demo, formulas("SUM(products.unit_price) + COUNTDISTINCT(orders.id)")),
    ).toEqual([
      { base: "dash_demo.orders", joins: [] },
      { base: "dash_demo.products", joins: [] },
    ]);
  });

  it("gives field-less measures the query's fact table, and needs one", () => {
    expect(describeJoins(demo, formulas("COUNT(1)", "SUM(order_items.quantity)"))).toMatchObject({
      base: "dash_demo.order_items",
    });
    expect(describeJoins(demo, formulas("COUNT(1)"))).toEqual({
      errors: ["a query needs a measure that reads a column, to know its fact table"],
    });
  });
});

describe("several fact tables (ADR 0014)", () => {
  const status = { field: "dash_demo.orders.status" };
  const category = { field: "dash_demo.products.category" };

  it("plans each fact's joins to the dimensions they share", () => {
    const query = valid(demo, {
      dimensions: [status],
      measures: [units, { formula: "COUNT(orders.id)" }],
      filters: [{ field: "dash_demo.orders.status", op: "in", values: ["paid"] }],
    });
    expect(describeFacts(demo, query)).toEqual([
      {
        base: "dash_demo.order_items",
        joins: ["dash_demo.order_items(order_id) -> dash_demo.orders"],
      },
      { base: "dash_demo.orders", joins: [] },
    ]);
  });

  it("needs every dimension reachable from every fact, and names the one that isn't", () => {
    const query = valid(demo, {
      dimensions: [category],
      measures: [units, { formula: "COUNT(orders.id)" }],
    });
    expect(describeFacts(demo, query)).toEqual({
      errors: [
        "dash_demo.products: reachable from dash_demo.orders only through one-to-many relationships (fan-out would repeat rows)",
      ],
    });
  });

  it("joins a CALCULATE condition's tables on the facts of the aggregates inside it", () => {
    const query = valid(demo, {
      measures: [units, { formula: 'CALCULATE(COUNT(orders.id), customers.country = "FR")' }],
    });
    expect(describeFacts(demo, query)).toEqual([
      { base: "dash_demo.order_items", joins: [] },
      {
        base: "dash_demo.orders",
        joins: ["dash_demo.orders(customer_id) -> dash_demo.customers"],
      },
    ]);
  });

  it("names a CALCULATE condition's table that an aggregate's fact can't reach", () => {
    const query = valid(demo, {
      measures: [units, { formula: "CALCULATE(COUNT(orders.id), order_items.quantity > 1)" }],
    });
    expect(describeFacts(demo, query)).toEqual({
      errors: [
        "dash_demo.order_items: reachable from dash_demo.orders only through one-to-many relationships (fan-out would repeat rows)",
      ],
    });
  });

  it("refuses the time functions and ALL for now", () => {
    const query = valid(demo, {
      dimensions: [{ field: "dash_demo.orders.ordered_at", timeGrain: "day" }],
      measures: [units, { formula: "PREVIOUSPERIOD(COUNT(orders.id))" }],
    });
    expect(describeFacts(demo, query)).toEqual({
      errors: ["a query over several fact tables can't use PREVIOUSPERIOD, RUNNINGSUM or ALL yet"],
    });
  });

  it("needs a column in every aggregate, to know its fact table", () => {
    const query = valid(demo, {
      measures: [{ formula: "COUNT(1)" }, units, { formula: "COUNT(orders.id)" }],
    });
    expect(describeFacts(demo, query)).toEqual({
      errors: [
        "measures[0]: COUNT reads no column; over several fact tables each aggregate needs one",
      ],
    });
  });

  it("keeps single-fact plans exactly as they were", () => {
    const query = valid(demo, { dimensions: [category], measures: [units] });
    const result = planJoins(query, demo);
    expect(result.ok && result.plan.facts).toBeUndefined();
  });
});
