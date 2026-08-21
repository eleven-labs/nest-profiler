---
'@eleven-labs/nest-profiler-typeorm': patch
'@eleven-labs/nest-profiler-mongoose': patch
'@eleven-labs/nest-profiler-mikro-orm': patch
---

Group the ORM Schema views under a **Schemas** sidebar heading.

Each schema collector repeated the subject in its own label (`Schema · TypeORM`, `Schema · Mongoose`, `Schema · MikroORM`) because there was nothing to group them under. They now declare the `schema` / **Schemas** sidebar group and keep the ORM name alone as their label, so the sidebar reads `Schemas` → `TypeORM` / `Mongoose` / `MikroORM` and the panel header restates the group (`Schemas / TypeORM`). The `?view=` keys are unchanged (`typeorm-schema`, `mongoose-schema`, `mikro-orm-schema`), so existing links keep working.

The three per-ORM screenshots collapse into one: the views differ only by the entities they list, and the **Schemas** heading now makes that obvious, so `schema-mongoose.png` and `schema-mikro-orm.png` are dropped and `schema.png` is renamed `schema-typeorm.png` for what it actually shows. The Mongoose and MikroORM pages keep their prose and point at the TypeORM walkthrough for a shot of the shared layout.
