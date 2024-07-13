# Splitwise Expense Importer Job

This job imports expenses from selective groups in splitwise to my self hosted expense management system.

## Use

- Create a `.env` file. Use `.env.example` as a reference.
- `node import.js` to run the job

## Groups Metadata

- Use `node dumpGroups.js` to dump group metadata like group Id to a file named `groups.json`