# ZombieCoder Integrity Manifest

> **কী:** repo-র source, scripts, tests, skills, `package.json` ও `LICENSE`-এর
> SHA-256 manifest। **কেন:** accidental বা unauthorized change ধরা। **সীমা:**
> এটা legal identity signature নয় — যে repo edit করতে পারে, সে manifest-ও
> regenerate করতে পারে।

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  2094ffd4d955191096aa788c0abe82f0c00f805c55acc9d122cd80d3303810c9  ║
║  files 52 · bytes 447454 · base 89114d5 · dirty                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

| Field | Value |
|---|---|
| Schema | `zombiecoder-integrity/v1` |
| Generated (UTC) | `2026-10-21T02:54:19.297Z` |
| Base commit | `89114d5` |
| Branch | `main` |
| Code tree | `dirty` |
| Files | 52 |
| Bytes | 447454 |
| Root SHA-256 | `2094ffd4d955191096aa788c0abe82f0c00f805c55acc9d122cd80d3303810c9` |

## Scope

- `src`
- `bin`
- `scripts`
- `test`
- `docs/skills`
- `package.json`
- `LICENSE`

## Verify

```bash
npm run integrity:check
```

`--check` কোনো file লেখে না; mismatch হলে exit code `1` দেয়।

## Files

| Path | Bytes | SHA-256 |
|---|---:|---|
| `bin/install.mjs` | 44036 | `4dd556cce53ad1b7e7c6c479dd3e5d00e76e331b7997cbb63fbc87d9721541c5` |
| `bin/quick-install.mjs` | 5685 | `fa97c3318d7630421e4f596044aa61da60c0f0d8b7533035f1013f462cedc078` |
| `docs/skills/cpanel.md` | 1867 | `f056fa581f9a0fa268556d8769fc2c5389a864fbd552e90b1692efde0c003537` |
| `docs/skills/evidence-before-confidence.md` | 1825 | `087195382d983591c2d2d5619ac0b36ee695ba3a0d9ef25bb5c7777911b034c3` |
| `docs/skills/fastapi.md` | 1655 | `336760d1a90ba33630224332e9da615b214d3ec627095be9ced772a4fbfb3d34` |
| `docs/skills/first-principles.md` | 1700 | `4e63d8eeb8ae30b39427fc6335c38891cffded74fc866246faf2224127fd5bef` |
| `docs/skills/laravel.md` | 1630 | `f35dc9c1bdf4d6217993761bbc1db7beee164dba54e17e4e03ade68b3361c33a` |
| `docs/skills/next.md` | 1669 | `afdf6e2a125f8f9db4357c2d11375dd76f2d3b6d75fe3cf21550c105d6b6d254` |
| `docs/skills/node.md` | 1392 | `44a57ebd465774ec2dba3a736e27c24b4e0dd8370ee5a3ada1a642d5a3301f27` |
| `docs/skills/python.md` | 1435 | `1fbd7bf69b3ee47b25c0ce08222989be4f2c74ce008f3702b7f913e584cf3b86` |
| `docs/skills/resource-optimization.md` | 1624 | `4180017cb251d46c33afae2b19b44d83ce7f52f6b315b3d0d5e0bd2bb182500e` |
| `docs/skills/server.md` | 1685 | `0149a648a6e8b4d8104097986e6796ceb224433707f5e73c281de5e7577eb4e3` |
| `LICENSE` | 1961 | `d06b8b22307bf25fa4e3dba778ad2ccc1350c2e5cd1b5e6ed40c2de25b6cd95a` |
| `package.json` | 1303 | `b54d5b1854c40cb0ab7b325a912d5906334b7da7b6fb8dc3ff4ec552e23ba848` |
| `scripts/configure.mjs` | 14582 | `ca232bbe03449daa0a465d6ea9acf9b47d2b4559442e1f60432e296edb6f9c70` |
| `scripts/integrity.mjs` | 10134 | `2a3485b44f9e85be5493252f07c815386c8e9c96013ff3f434f368fd44f1b867` |
| `scripts/lsp-probe.mjs` | 6203 | `84584f12a0fb62235314474ecee3efdda1e5e921f88f16dc323c09ee840433ab` |
| `scripts/setup.mjs` | 12779 | `76e35cf8c0cabbaf20fdae48ff051c8c01086def378f3c867fd2de2e2c0ae777` |
| `src/agents.ts` | 13483 | `f54b4e41b6934c0d5e6dcf8fff4af718ba919bfddb65f3329456a4746d10dd8b` |
| `src/ethics.ts` | 10670 | `db6c18984a5357106de459cd701c613c293971be372785594d57e83eeea7c921` |
| `src/generate.ts` | 5739 | `e7f4ac46cf1eaa29920a3431f4be39e231d3103b162d36dd1fb9d3384fb87ad8` |
| `src/identity.ts` | 8055 | `b22066b981cbb755e896eb7a717eb3e7d3162102205bb3e3166ecd939f195ba4` |
| `src/plugin.ts` | 41393 | `631fe154deb1e591541a6a7990e6b0fc907eab63cf16a4ddf87f4d7e4753e574` |
| `src/roster.ts` | 25905 | `21abdef9056b9cb304cc471073a3e452de9d63d87d2a40e75eb2c027fd2ea1bc` |
| `src/runtime.ts` | 13347 | `5c6bd9288f65e9a13c016e3732b402a67b72b36b8fd991d2e4cec7789aba4654` |
| `src/zombie/context.ts` | 6882 | `56234660c14970c4b77d1ead0726355bcc0f8fb3ad3a71802ba201923b993fb8` |
| `src/zombie/defaults.ts` | 2668 | `bdd1da278ec370626c5b0f45622f1989ace2d5c27efde5f040fbac766e142a87` |
| `src/zombie/io.ts` | 4067 | `fe00c59bd59aa98b5a33ff56d19faf6a4847fb49cfb557b1d93bd93285a51c76` |
| `src/zombie/lsp.ts` | 13112 | `4ad4e476d20812de3f93bb8182d535cd3e1ed2764a8e117083daa9511cb25604` |
| `src/zombie/mcp.ts` | 5564 | `2222d1adb6307c9767ac7392457acd25cf991c9130559825cc5ab383d6503b8a` |
| `src/zombie/memory.ts` | 8901 | `26cd115dfec0eec8a5569a6dfa91e89897a171b9032d92d936c4963a48d43d56` |
| `src/zombie/models.ts` | 15856 | `ab330f7d0a3532931c6cc6bdc746a46cce2f7a3db27db3a5bacaf90a065f3d42` |
| `src/zombie/origin.ts` | 5116 | `6b37139ebcf59a436a05e3fb3eb28be4ad4aa195a099fe388faab9030d73567c` |
| `src/zombie/paths.ts` | 3380 | `e505c8ac33c49b1028b887d5396157bf75457a342af37290da2caa0b8fc14875` |
| `src/zombie/responseGate.ts` | 12199 | `f334902b7008adb792fd0b84fed7f780e09de6e4167475761e534d5cd2140ddb` |
| `src/zombie/scan.ts` | 7494 | `c8b6169192da8a4dc96fb623a432e8719a9c4eeaabc24b096cc542554e57fa3b` |
| `src/zombie/server.ts` | 19548 | `2bbb41fa43a592c1c7113d2d045869c9aedf97a829d667e38a22b07fd03fdc01` |
| `src/zombie/skillCatalog.ts` | 15410 | `50033eb25880091f7084116ccbd70d5beb6ba1f2875d35a0e5fb9b62d06b81be` |
| `src/zombie/skills.ts` | 4964 | `c0a1fafd9aa8b0ad0d2c473ceb63df98afb9630826706da676fa22d37cc155d0` |
| `src/zombie/ssot.ts` | 6982 | `a59b27089fcf6148337f6c4d84461c6d30c6034d75b39c7173f5ec23526b65cc` |
| `src/zombie/syllabus.ts` | 7542 | `b564b2cb1e02c1e45f222b40cd39f2bf4d2b52a5fe01b7ff4b543d518a0f29ac` |
| `src/zombie/transform.ts` | 3964 | `1c25f3eb1f6ecc9c8ed68b9894f2dfcffb75e233540be06b81f8bda78cc11ba2` |
| `test/context.test.ts` | 8668 | `4db8049a8b0d5ef364fbf07b26cbb848db18940001cb3a87db5feb0d918b7a15` |
| `test/install.test.ts` | 13575 | `5eb13653e8ab5d494ae625b3e29becd6a1eb3486cd3c9b9e9363046c793bc8d6` |
| `test/lsp.test.ts` | 2276 | `e6808cbdb5df0d78dd645b1b5a0e73ce64029eb2aa0e09516e585e523b673a6a` |
| `test/mcp.test.ts` | 2352 | `b4ccdef6695d1b05082cd6ea7a1003f692daf606913e9456be1eca2c61e98fb7` |
| `test/memory.test.ts` | 3086 | `36beb46ef6c048a8b1ccae4e7aa3e59be854109cc83139b7985e418fdb9d8b8f` |
| `test/models.test.ts` | 10179 | `bde6fad325b859bf8522602813a849e0ab9f3ad8e59f8e41aa5e6fc120835c98` |
| `test/origin.test.ts` | 4002 | `d75f26822785389c2c9a3b1213c74555ced930c374797d2e702c80fad6788b9f` |
| `test/plugin.test.ts` | 21526 | `e49bc70ec50d5bf377538a1259658015c0c7a6a10feea22a186b8197d4417480` |
| `test/repo.test.ts` | 2891 | `dfe11cfde7963d84f580a12d49c6acbf81494a9087e4dbe1c04ebca4e9c0427e` |
| `test/skillCatalog.test.ts` | 3493 | `dbc1788cdd977905130663ad555f147edd3c63cbd65688ceeea0449c117f639c` |

## Footer

এই manifest-টা নিজে hash-এ ধরা নেই। ফুটারের root hash বদলালে
`npm run integrity` চালিয়ে regenerate করুন।
