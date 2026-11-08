# Stockroom

Stockroom lets a shopper ask for a one-time email when an item comes back in stock. It includes a storefront form, an authenticated activity panel, and a durable delivery queue. The app uses Node.js 24, TypeScript, and SQLite, with no dependencies to install.

## Run locally

1. Clone the [challenge simulator](https://github.com/yitzi-farla/back-in-stock-challenge) beside this project. In that checkout, run `node harness/server.js`.
2. Open [the local simulator](http://127.0.0.1:3000), create a test identity, and copy the stock API URL, stock API key, email API key, email base URL, and webhook secret from its dashboard.
3. Copy `.env.example` to `.env` in this project. Fill in the values from the simulator and run `node --env-file=.env src/server.ts`.
4. Set the app URL in the simulator dashboard to `http://127.0.0.1:8080`. Open [the storefront form](http://127.0.0.1:8080/embed?sku=TEE-ORG-WHT-M) and submit a test email. Restock that item in the simulator and check its email inbox.
5. Open [the activity panel](http://127.0.0.1:8080/admin). Sign in as `admin` with `ADMIN_PASSWORD` or the generated password in `data/admin-password`.

### Live demo

[Open the hosted Stockroom demo](https://stockroom-back-in-stock-production.up.railway.app/demo). Sign in as `admin` with the reviewer password provided privately. The demo includes its own simulator and uses synthetic data only.

For an all-in-one local demo, run `npm run demo:prepare` once, then `npm run demo`. Open [the demo](http://127.0.0.1:8080/demo). This downloads a fixed revision of the official public simulator, verifies its checksum, and starts it on a private loopback port. Synthetic credentials and test data are generated locally, with no real email account required.

**Run complete test** sells out the selected product, registers an alert, and restocks it. The inbox, alert status, and stock activity update automatically. Individual controls let you test duplicate webhooks, false restocks, and an injected email failure. Every message is captured by the simulator. Use `@example.com` addresses.

To connect a simulator you already run locally, set `DEMO_HARNESS_STATE_FILE` to its `db.json` and run the normal app with that simulator's environment variables. The panel reads only the candidate matching the app's stock API key. Credentials remain on the server.

The normal challenge app does not enable the demo by default. See [hosted demo setup](DEPLOYMENT.md) to publish the password-protected panel with its private simulator.

| Variable | Purpose |
| --- | --- |
| `STOCK_API_URL` and `STOCK_API_KEY` | Stock endpoint and bearer key from the simulator. |
| `RESEND_BASE_URL` and `RESEND_API_KEY` | Simulated email API base URL and bearer key. |
| `WEBHOOK_SECRET` | Shared secret for incoming stock events. |
| `ADMIN_PASSWORD` | Optional. The app generates and saves a password if omitted. |
| `FROM_EMAIL` | Optional sender override. The default is suitable for the simulator. |
| `PORT`, `HOST`, and `DATA_DIR` | Optional. Native defaults are `8080`, `127.0.0.1`, and `data`. |

## Run in Docker

When the simulator runs on the host, use `http://host.docker.internal:3000/api/stock` and `http://host.docker.internal:3000` for the stock and email URLs in the container's environment file. The simulator's callback still points to the published app port on the host.

```sh
docker build -t stockroom .
docker run --rm --name stockroom --env-file .env -p 127.0.0.1:8080:8080 -v stockroom-data:/app/data stockroom
```

Use `PORT=8080` in the environment file for the command above. If you use the generated admin password, read it with `docker exec stockroom cat /app/data/admin-password`. Keep the database on a volume across container replacements. Use one app instance per database and terminate HTTPS at the proxy if hosting it publicly.

## Delivery and recovery

SQLite enforces one outstanding request per normalized email and SKU. A stock webhook is acknowledged only after its event ID is stored. The worker verifies current inventory and atomically queues eligible alerts as it records the event as processed.

Each queued alert keeps the same email payload and idempotency key across retries. The worker marks it notified only after receiving an email ID from the provider. If the app loses the response after an accepted send, the simulator deduplicates the retry using that key. Pending stock checks and deliveries survive a restart. The activity panel shows the current state, notification time, and the latest email error when a retry is pending.

## Integration tests

Set `HARNESS_DIR` to the path of the local simulator checkout. For example, in PowerShell:

```powershell
$env:HARNESS_DIR = (Resolve-Path ../back-in-stock-challenge).Path
node --test
```

The suite starts its own simulator and app on temporary ports. It exercises the form and admin routes, duplicate requests, invalid webhook secrets, false restocks, simultaneous stock events, an injected email failure, and recovery after an app restart. It also drops an accepted email's response to verify that a retry produces only one delivered message. It uses synthetic email addresses and the local simulator only.

These are integration tests against the public simulator, not the client's private grading suite.

## AI-assisted workflow

Built with OpenAI Codex for implementation, debugging, integration tests, Docker packaging and browser verification. Human review guided the requirements, edge cases, and demo experience. The implementation was tested against the client's public simulator; the interactive demo is an additional review aid.

Actual elapsed development time will be stated in the Upwork proposal, including testing and demo improvements.
