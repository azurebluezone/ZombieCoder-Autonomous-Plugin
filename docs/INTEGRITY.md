# ZombieCoder Integrity Manifest

> **কী:** repo-র source, scripts, tests, skills, `package.json` ও `LICENSE`-এর
> SHA-256 manifest। **কেন:** accidental বা unauthorized change ধরা। **সীমা:**
> এটা legal identity signature নয় — যে repo edit করতে পারে, সে manifest-ও
> regenerate করতে পারে।

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  a0f9a4ab913dd951fc7fa90bef2052014c053bc70e16c6759c6f54c9900d5849  ║
║  files 55 · bytes 540279 · base 34bef15 · dirty                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

| Field | Value |
|---|---|
| Schema | `zombiecoder-integrity/v1` |
| Generated (UTC) | `2026-10-22T13:41:37.373Z` |
| Base commit | `34bef15` |
| Branch | `main` |
| Code tree | `dirty` |
| Files | 55 |
| Bytes | 540279 |
| Root SHA-256 | `a0f9a4ab913dd951fc7fa90bef2052014c053bc70e16c6759c6f54c9900d5849` |

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
| `bin/install.mjs` | 52080 | `811722379706c312f26c283856eae9ec25e664642c53b4cdba6de90e68a5288a` |
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
| `scripts/setup.mjs` | 12823 | `878630ae6341e951f4f7309ec44d7c3fef5df07f03ded65864981358ed4dfda9` |
| `src/agents.ts` | 13483 | `f54b4e41b6934c0d5e6dcf8fff4af718ba919bfddb65f3329456a4746d10dd8b` |
| `src/ethics.ts` | 10670 | `db6c18984a5357106de459cd701c613c293971be372785594d57e83eeea7c921` |
| `src/generate.ts` | 5739 | `e7f4ac46cf1eaa29920a3431f4be39e231d3103b162d36dd1fb9d3384fb87ad8` |
| `src/identity.ts` | 8055 | `b22066b981cbb755e896eb7a717eb3e7d3162102205bb3e3166ecd939f195ba4` |
| `src/plugin.ts` | 53561 | `d24ffe0bfd1eecc937b31308dc2cfc6e089f2efd5076e865ac62e66fe67e5aab` |
| `src/roster.ts` | 29021 | `e809178e4faa55644ed330131236c184a229d5719806d458debe9e92896fd632` |
| `src/runtime.ts` | 15672 | `d82c9fc232c62e3bcc93f384bca36b2d8d0635bcb3b016a6242a978575fbf6b3` |
| `src/zombie/circuitBreaker.ts` | 7498 | `ef7bc1023a1740d7284fabe9bfa0af7b65e5539d8f76fbdf03c17a2101ce4bd1` |
| `src/zombie/context.ts` | 8852 | `b40de7a5d37427cea88246d4aff6e66a383d8bbf98a34be6b0cad81f002822f5` |
| `src/zombie/defaults.ts` | 2668 | `bdd1da278ec370626c5b0f45622f1989ace2d5c27efde5f040fbac766e142a87` |
| `src/zombie/io.ts` | 5006 | `89b3f44e558f7b7d07735a9ac0a1fc3f610794c2ac10f50d3e7cd19b379d5dad` |
| `src/zombie/lsp.ts` | 13112 | `4ad4e476d20812de3f93bb8182d535cd3e1ed2764a8e117083daa9511cb25604` |
| `src/zombie/mcp.ts` | 5564 | `2222d1adb6307c9767ac7392457acd25cf991c9130559825cc5ab383d6503b8a` |
| `src/zombie/memory.ts` | 11261 | `591eab6db230579bc1511176869992fce01f062b3c8bb419387272d1bbf8d6a2` |
| `src/zombie/models.ts` | 16876 | `3128045088e1a5ae47f6393f93f269f5bfc59ab874fef33823e876055464459c` |
| `src/zombie/origin.ts` | 5116 | `6b37139ebcf59a436a05e3fb3eb28be4ad4aa195a099fe388faab9030d73567c` |
| `src/zombie/paths.ts` | 3380 | `e505c8ac33c49b1028b887d5396157bf75457a342af37290da2caa0b8fc14875` |
| `src/zombie/responseGate.ts` | 25816 | `8080d06a233013666f311d12273167c1b4878e860d35adddfe270733c21b2e13` |
| `src/zombie/scan.ts` | 7562 | `9a9b657954f86a7f758a0d1fe17523a9d4c8496803c1e72017c3a7ce88116ade` |
| `src/zombie/server.ts` | 21043 | `4c0c6b73bd144ce8863af8884aaf748205ab0f2bd2d9edd624d6d764a90618f0` |
| `src/zombie/skillCatalog.ts` | 15410 | `50033eb25880091f7084116ccbd70d5beb6ba1f2875d35a0e5fb9b62d06b81be` |
| `src/zombie/skills.ts` | 4964 | `c0a1fafd9aa8b0ad0d2c473ceb63df98afb9630826706da676fa22d37cc155d0` |
| `src/zombie/ssot.ts` | 6982 | `a59b27089fcf6148337f6c4d84461c6d30c6034d75b39c7173f5ec23526b65cc` |
| `src/zombie/syllabus.ts` | 7542 | `b564b2cb1e02c1e45f222b40cd39f2bf4d2b52a5fe01b7ff4b543d518a0f29ac` |
| `src/zombie/transform.ts` | 3964 | `1c25f3eb1f6ecc9c8ed68b9894f2dfcffb75e233540be06b81f8bda78cc11ba2` |
| `test/circuitBreaker.test.ts` | 3676 | `08d6ece5d464358a6fe2837bbf7b2b091770fd7c14fa0e29a9f25fe5180922fc` |
| `test/context.test.ts` | 21022 | `bac9a9dc417df41d0c7be8533855df5999c1a5622441ab39b484df67346fbfbb` |
| `test/install.test.ts` | 20331 | `710e391bb6d738cfd22ad40c1f1ae3a9b1912f67201e700563d33ba26f79e06c` |
| `test/io.test.ts` | 959 | `c483a9c9f9a4ca51e595df125fb36a8a23627a331ac9fbe871f1c404f858fe4a` |
| `test/lsp.test.ts` | 2276 | `e6808cbdb5df0d78dd645b1b5a0e73ce64029eb2aa0e09516e585e523b673a6a` |
| `test/mcp.test.ts` | 2352 | `b4ccdef6695d1b05082cd6ea7a1003f692daf606913e9456be1eca2c61e98fb7` |
| `test/memory.test.ts` | 5971 | `7be693ccf8cba4111b8f4a0a7d70d13f83934b20a0c085a9bb44eafd7315c7b8` |
| `test/models.test.ts` | 10636 | `d1ff441602ce36b28de1e0198ab01d9efe4ab05d301bacfe5039e250b6364586` |
| `test/origin.test.ts` | 4002 | `d75f26822785389c2c9a3b1213c74555ced930c374797d2e702c80fad6788b9f` |
| `test/plugin.test.ts` | 32600 | `09e83d88c19fd52c40553bfaaed7a32a5d34d44d4537721815ac016c3ae9a7a1` |
| `test/repo.test.ts` | 2891 | `dfe11cfde7963d84f580a12d49c6acbf81494a9087e4dbe1c04ebca4e9c0427e` |
| `test/skillCatalog.test.ts` | 3493 | `dbc1788cdd977905130663ad555f147edd3c63cbd65688ceeea0449c117f639c` |

## Footer

এই manifest-টা নিজে hash-এ ধরা নেই। ফুটারের root hash বদলালে
`npm run integrity` চালিয়ে regenerate করুন।
