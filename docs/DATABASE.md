#DATABASE

Mame-ui-extractor use a sqlite database and Sequelize ORM.

##Migration :
To manage migration, we use `sequelize-cli`
```bash
npx sequelize-cli migration:generate --name=migration-name
```
A file named `XXXXXXXXXXXXXX-migration-name.js` is created in directory `migrations`

Migrations are executed automatically when the application start with `Umzug`
