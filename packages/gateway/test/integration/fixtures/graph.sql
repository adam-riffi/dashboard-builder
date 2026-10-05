-- Fixture: an airline schema for relationship edge cases. Self reference, two foreign keys to
-- one table, a composite foreign key, a table without a primary key, and a foreign key to a
-- table that is not allowlisted.
drop schema if exists fx_graph cascade;
create schema fx_graph;

create table fx_graph.airports (
  code char(3) primary key,
  city text not null
);

create table fx_graph.employees (
  id int primary key,
  name text not null,
  manager_id int references fx_graph.employees (id),
  hired_on date
);

create table fx_graph.flights (
  carrier char(2),
  number int,
  origin char(3) not null references fx_graph.airports (code),
  destination char(3) not null references fx_graph.airports (code),
  departs_at timestamptz not null,
  pilot int references fx_graph.employees (id),
  primary key (carrier, number)
);

create table fx_graph.legs (
  carrier char(2) not null,
  number int not null,
  seq int not null,
  duration_minutes int not null,
  foreign key (carrier, number) references fx_graph.flights (carrier, number)
);

create table fx_graph.hangars (
  id int primary key
);

create table fx_graph.audit (
  at timestamptz not null,
  note text,
  hangar int references fx_graph.hangars (id)
);

insert into fx_graph.airports values ('CDG', 'Paris'), ('JFK', 'New York'), ('NRT', 'Tokyo');
insert into fx_graph.employees values (1, 'Ada', null, '2020-01-01'), (2, 'Bo', 1, '2021-06-01'), (3, 'Cy', 1, null);
insert into fx_graph.flights values
  ('AF', 6, 'CDG', 'JFK', '2026-03-01 10:00+00', 2),
  ('AF', 276, 'CDG', 'NRT', '2026-03-01 22:00+00', 3),
  ('JL', 46, 'NRT', 'CDG', '2026-03-02 11:00+00', null);
insert into fx_graph.legs values ('AF', 6, 1, 500), ('AF', 276, 1, 780), ('JL', 46, 1, 840), ('JL', 46, 2, 30);
insert into fx_graph.hangars values (1);
insert into fx_graph.audit values ('2026-03-01 09:00+00', 'opened', 1), ('2026-03-01 23:00+00', null, null);

analyze fx_graph.airports, fx_graph.employees, fx_graph.flights, fx_graph.legs, fx_graph.audit;
