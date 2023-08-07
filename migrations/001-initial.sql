--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------
create table branches (
  name     text not null,
  resource text not null,
  strategy text not null,
  parent   text not null,
  primary key (name, resource),
  foreign key (parent, resource) references branches(name, resource)
);

create table events (
  id        integer primary key autoincrement not null,
  branch    text not null,
  resource  text not null,
  timestamp datetime not null default (strftime('%Y-%m-%d %H:%M:%f', 'now')), 
  status    text check (status in ('requested', 'activating', 'active', 'deactivating', 'inactive', 'error')) not null,
  message   text,
  foreign key(branch, resource) references branches(name, resource)
);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------
drop table events;
drop table branches;
