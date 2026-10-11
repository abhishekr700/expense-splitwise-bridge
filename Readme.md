# Splitwise Expense Importer Job

This job imports expenses from selective groups in splitwise to my self hosted expense management system.

## Use

- Create a `.env` file. Use `.env.example` as a reference.
- `node import.js` to run the job

## Authentication

Splitwise has paywalled developer API keys behind Splitwise Pro. This project authenticates using persistent browser session cookies with automatic 13-month rolling renewal and Docker volume support. See [docs/splitwise-auth.md](docs/splitwise-auth.md) for full details on how the bypass works and how to set it up.

## Groups Metadata

- Use `node dumpGroups.js` to dump group metadata like group Id to a file named `groups.json`