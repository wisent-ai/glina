# Walkthrough: serve the desktop protocol and verify over HTTP

This walkthrough starts only Glina's loopback Node backend and runs the local structural gate. It does not call `/v1/blender-health`, start a Blender MCP process, or touch the live Blender bridge. The exact script is [`examples/serve-verify.sh`](examples/serve-verify.sh); it was executed with Node v22 on macOS.

## 1. Start on an ephemeral port

The script writes a temporary non-secret config, then launches:

```sh
node pipeline/cli.js serve --port 0 --config "$WORK/plain.json"
```

`serve` bound `127.0.0.1` and printed one ready line. The script extracted the port; the captured run reported:

```console
backend ready on 127.0.0.1:62357
```

The number is intentionally ephemeral and will differ on another run. A desktop client must read the ready JSON instead of assuming 62357.

## 2. Probe process health

```console
$ curl -s http://127.0.0.1:62357/v1/health
{
  "status": "ok"
}
```

This proves only that the HTTP process is answering. Blender health is a separate, stateful probe.

## 3. Stream a verification job

The script posts the reference dragon path:

```sh
curl -s -X POST "http://127.0.0.1:$PORT/v1/verify" \
  -H 'content-type: application/json' \
  -d '{"path":"…/assets/models/smok.glb"}'
```

The exact captured protocol payload (path shortened here) was one terminal NDJSON event:

```json
{"type":"result","status":0,"json":{"ok":true,"errors":[],"stats":{"meshes":38,"primitives":38,"triangles":748,"materials":5,"animations":2,"animationNames":["flap","idle"],"textures":0,"nodes":48,"animationChannels":54,"movingAnimationChannels":8,"staticAnimationChannels":46},"thresholds":{"triTarget":6000,"triTolerancePct":100,"requireMaterials":true,"requireAnimations":false,"minAnimationClips":0,"minBytes":100,"maxBytes":67108864,"enabled":true},"path":"…/assets/models/smok.glb"}}
```

No log events preceded it because structural verification is quiet. Sculpt and preview jobs may emit any number of log events before the single result.

## 4. Implement a consumer safely

1. Spawn `glina serve --port 0` and parse the first stdout line as `{ready:true,port}`.
2. Keep stderr separate; stdout is the startup protocol.
3. For an NDJSON endpoint, parse one JSON object per line and append `log.chunk` in arrival order.
4. Do not equate HTTP 200 with success. Wait for `type:"result"` and inspect `status` plus the result document.
5. If the stream closes without a result, treat it as an incomplete exchange.
6. Terminate the backend when the owning app exits.

That is the same lifecycle implemented by the [macOS desktop companion](desktop.md).
