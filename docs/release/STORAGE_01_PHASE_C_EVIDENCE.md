# STORAGE_01 Phase C Evidence

## Status

Phase C evidence is reconstructed from the prior verified ephemeral session.
No destructive Phase C operation was rerun during recovery. Repository and
local-runtime inspection was limited to the configuration and deployment facts
needed to persist this evidence.

The evidence contains no credentials, object keys, signed URLs, or secret
values.

## Verified Results

| Check | Result |
| --- | --- |
| OpenCode purity | PASS |
| Compatibility bucket cleanup | PASS |
| Compatibility bucket existence | PASS |
| Region discovery | PASS |
| SigV4 | PASS |
| PUT/stat/GET | PASS |
| SHA-256 integrity | PASS |
| Presigned PUT | PASS |
| Presigned GET | PASS |
| Private bucket enforcement | PASS |
| Authenticated access | PASS |
| Path-style addressing | PASS |
| Virtual-host addressing | NOT_REQUIRED |
| Endpoint semantics | PASS |
| SSE observation | PASS |
| Exact-key deletion | PASS |
| CORS functional compatibility | PASS |
| CORS provider semantic deviation | YES |
| Compatibility bucket cleanup after testing | PASS |
| Production modified | NO |
| Production health | PASS |

## Contabo CORS Exception

The provider accepted an exact CORS origin rule but returned:

```text
Access-Control-Allow-Origin: *
```

This is a Contabo-specific provider behavior. It is functionally compatible
with BuildingOS for the tested flow because:

- the bucket remains private;
- BuildingOS authorizes before issuing presigned URLs;
- browser uploads use direct presigned `PUT` requests;
- XMLHttpRequest does not use `withCredentials`;
- browser cookies and credentials are not sent to object storage;
- `Access-Control-Allow-Credentials` is not required;
- direct downloads use presigned URLs or navigation;
- path-style addressing works; and
- virtual-host addressing is not required.

This exception does not weaken the general BuildingOS security policy. It is
accepted only for the Contabo compatibility result and must not be generalized
to other providers or used as justification for a public bucket.

## Revalidation Boundary

The current local Docker runtime has no attached staging containers and no
Contabo credentials. The local checks therefore did not re-execute remote
provider behavior. The Phase C results above remain the prior verified test
evidence, while the recovered Phase D documents explicitly gate rollout on
fresh provider and staging validation.
