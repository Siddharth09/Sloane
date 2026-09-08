# Setting up the RunPod Serverless endpoint (one-time, console-only)

This is the one part of the Serverless migration that has to happen in
RunPod's own console under your account (connecting GitHub and creating the
endpoint needs your account-level authorization, which an API key can't do).
Everything else (the handler code, Dockerfile, Next.js/mobile wiring) is
already done — this is the last step to make it live.

## 1. Connect GitHub to RunPod

1. Go to [runpod.io/console/serverless](https://www.runpod.io/console/serverless)
2. Click **New Endpoint**
3. Under the image source options, choose **GitHub Repo** (instead of Docker
   Registry — this avoids needing a separate Docker Hub account)
4. Authorize RunPod's GitHub App if prompted, and grant it access to the
   `Siddharth09/Sloane` repo
5. Select that repo and the `main` branch. RunPod will find the `Dockerfile`
   at the repo root automatically.

## 2. Configure the endpoint

- **Name**: `lucy-audio` (or anything memorable)
- **GPU**: RTX 4090 (matches what the Pod was using)
- **Worker count**: **Min workers: 0**, **Max workers: 3** (this is the whole
  point of the migration — 0 min workers means no cost while idle)
- **Idle timeout**: leave at the default (5s) for now
- **Network Volume**: attach `oc6yvg9b19` (the same volume the Pod used —
  under Advanced settings)

## 3. Deploy

Click **Deploy**. RunPod will build the image from the Dockerfile and start
the endpoint. This first build can take a few minutes; after that, only
workers themselves cold-start per-request (not a rebuild).

## 4. Get the Endpoint ID and send it back

Once deployed, the endpoint's page shows an **Endpoint ID** (a short
alphanumeric string in the URL and on the page). Send that back — it needs
to go into `web/.env.local` as `RUNPOD_ENDPOINT_ID` (and into Vercel's
project environment variables for the live site), which is the last wiring
step before this goes live.

## One-time setup already done on the network volume

- `pip install runpod` was run inside `/workspace/sloane/.venv` on the
  volume, so cold starts don't pay for that install every time.

## After this is live

Once `RUNPOD_ENDPOINT_ID` is set and confirmed working, `sloane-retrain`
(the old always-on Pod) is no longer needed for serving traffic — leave it
stopped. It's fine to start it manually later for admin work (e.g. another
retraining run), just not for live traffic.
