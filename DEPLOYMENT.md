# Publish the interactive demo

Use a dedicated GitHub repository for this project and a single Docker service with one persistent volume. The normal `Dockerfile` runs the challenge app against whatever stock/email endpoints the reviewer supplies. `Dockerfile.demo` additionally runs the client's public simulator privately so reviewers can try the whole flow from one page.

## Railway

1. Create a service from this GitHub repository. Set `RAILWAY_DOCKERFILE_PATH=Dockerfile.demo` before its first successful deployment.
2. Attach one volume at `/app/data`. Use one replica. Set `RAILWAY_RUN_UID=0` if required for the mounted volume's ownership.
3. Set `ADMIN_PASSWORD` to a unique random value with at least 16 characters in Railway's variable settings. Do not commit it.
4. Generate a public domain targeting port `8080`. Set `DEMO_PUBLIC_ORIGIN` to its exact HTTPS origin, with no trailing slash. Alternatively the launcher uses `RAILWAY_PUBLIC_DOMAIN` if supplied by Railway.
5. Set the health check path to `/healthz` and deploy. Open `/demo` with username `admin` and the password above. The same credentials open `/admin`.
6. Run a complete test with both **Send the same webhook twice** and **Fail the next email attempt** enabled. Verify one accepted email and a notified alert. Restart the deployment and verify the records persist.

Share the application URL and reviewer password privately in the proposal. The demo remains protected by authentication over HTTPS. It only accepts synthetic `@example.com` email addresses. No domain purchase or real Resend account is needed.

## Docker preview

```sh
docker build -f Dockerfile.demo -t stockroom-demo .
docker run --rm --name stockroom-demo -p 127.0.0.1:8080:8080 -v stockroom-demo-data:/app/data \
  -e DEMO_PUBLIC_ORIGIN=https://your-demo.example \
  -e ADMIN_PASSWORD="your-unique-reviewer-password" stockroom-demo
```

Place a trusted HTTPS proxy in front of this container. It must preserve the configured host. The origin check deliberately rejects other hosts and cross-origin control requests. For a local demo without a proxy, use the native `npm run demo` command.

## Simulator provenance and limits

The image downloads `harness/server.js` from the official challenge repository at revision `f997f1da5030476fc15ecf582a8614f1bd3a684f`. `scripts/fetch-harness.mjs` validates the normalized source SHA-256 and changes only the listener binding to `127.0.0.1`. The simulator source and generated credentials are excluded from Git. Its stock, email, failure and duplicate behavior are unchanged. Its private grader is not included.

The launcher saves simulator state and the app's SQLite database in separate directories under `/app/data`, reuses the same simulator identity after restarts, disables random background events, and shuts down both processes together. Only the application port is exposed. Reviewers share one test environment, so coordinated tests are best run one at a time.

Keep this a short-lived review environment. Hosting credits and costs depend on the account plan and actual usage.
