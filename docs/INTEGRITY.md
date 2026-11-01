# ZombieCoder Integrity Manifest

> **কী:** repo-র source, scripts, tests, skills, `package.json` ও `LICENSE`-এর
> SHA-256 manifest। **কেন:** accidental বা unauthorized change ধরা। **সীমা:**
> এটা legal identity signature নয় — যে repo edit করতে পারে, সে manifest-ও
> regenerate করতে পারে।

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  d13bee2b8c34425f7957cfbcc6ea98cd6196c83c8920315456edbdc424ac405f  ║
║  files 119 · bytes 1204879 · base 6ef802c · dirty                        ║
╚══════════════════════════════════════════════════════════════════════════╝
```

| Field | Value |
|---|---|
| Schema | `zombiecoder-integrity/v1` |
| Generated (UTC) | `2026-11-01T21:29:27.777Z` |
| Base commit | `6ef802c` |
| Branch | `murubbi` |
| Code tree | `dirty` |
| Files | 119 |
| Bytes | 1204879 |
| Root SHA-256 | `d13bee2b8c34425f7957cfbcc6ea98cd6196c83c8920315456edbdc424ac405f` |

## Scope

- `src`
- `bin`
- `scripts`
- `test`
- `mcp`
- `docs/skills`
- `install.sh`
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
| `bin/install.mjs` | 86292 | `7fa7b52b83b39b84c11a4a4733dc917231e1310ec8a81c692f3be60971ad224f` |
| `bin/quick-install.mjs` | 5685 | `fa97c3318d7630421e4f596044aa61da60c0f0d8b7533035f1013f462cedc078` |
| `docs/skills/bootstrap.md` | 574 | `0580d9dff2bf4a466597b5dcb41792ba7bba22175e37ff95dfa716acb057e51c` |
| `docs/skills/cpanel.md` | 1867 | `f056fa581f9a0fa268556d8769fc2c5389a864fbd552e90b1692efde0c003537` |
| `docs/skills/evidence-before-confidence.md` | 3140 | `6f05dd0fc50a97fb8d0eaf77be0f68aee5ee4760847e98a7d3ca3ffb51fe21f7` |
| `docs/skills/fastapi.md` | 1655 | `336760d1a90ba33630224332e9da615b214d3ec627095be9ced772a4fbfb3d34` |
| `docs/skills/first-principles.md` | 1752 | `a6081c550298eb25bbb9d887be98e642a7a4f239ece4b9c8b3cec9865297db3a` |
| `docs/skills/laravel-market.md` | 4175 | `4fa4ae4e951967bfa750d417dc67e16b41c478b48035a1e34d62b065d8475fac` |
| `docs/skills/laravel.md` | 1910 | `51b883d978bb3413e243cee90e00db1e25a6b200fd0eaf38d4576aedbb079dec` |
| `docs/skills/llama-cpu.md` | 576 | `349dbaa66d650c820595498287f3799ac9efb39b11b7391f8680103e84380aef` |
| `docs/skills/next.md` | 1669 | `afdf6e2a125f8f9db4357c2d11375dd76f2d3b6d75fe3cf21550c105d6b6d254` |
| `docs/skills/node.md` | 1392 | `44a57ebd465774ec2dba3a736e27c24b4e0dd8370ee5a3ada1a642d5a3301f27` |
| `docs/skills/ollama.md` | 512 | `81dfb0ff1ba9b7596304e63c3e8b6ccbde844ea8ca6bfd7f79012795b4053813` |
| `docs/skills/python-regex.md` | 3759 | `c3afda66297c80485974f66c4212eec935bfccd4431c75c6c6f2210e1406aa95` |
| `docs/skills/python.md` | 1435 | `1fbd7bf69b3ee47b25c0ce08222989be4f2c74ce008f3702b7f913e584cf3b86` |
| `docs/skills/resource-optimization.md` | 1624 | `4180017cb251d46c33afae2b19b44d83ce7f52f6b315b3d0d5e0bd2bb182500e` |
| `docs/skills/scrape-verify.md` | 3098 | `2234c0e92c4ee379cf1268d6f2f62fbf12a1443f73f30f0d36a9f1b41671ef8d` |
| `docs/skills/server.md` | 1685 | `0149a648a6e8b4d8104097986e6796ceb224433707f5e73c281de5e7577eb4e3` |
| `docs/skills/tailwind.md` | 595 | `d89971988125a3d5cc457034e172ca54d758d03c277e9a8b57554b7d06e38e1b` |
| `docs/skills/typescript.md` | 638 | `07d314e2ab542bbfe39b5fdcfd1e4f8ebc255b61ca989c3f9970608e1095cc5e` |
| `docs/skills/uiux-delivery.md` | 3952 | `c2a66f4f4f3edbee5135b6e4b05ef82165f35baf1f9a7138c0d0f0d268394e15` |
| `docs/skills/web-delivery.md` | 4247 | `61ce13fc7897d4cb1a7bd59cfaa058ef6d94d6d7e7cb34295b179bc7e72cf0db` |
| `install.sh` | 35845 | `5e36ebb1642b487cd10ad7e84afbd8e6ee8c9093d753ab98ab146719de453853` |
| `LICENSE` | 1961 | `d06b8b22307bf25fa4e3dba778ad2ccc1350c2e5cd1b5e6ed40c2de25b6cd95a` |
| `mcp/image-brand/e2e-live.mjs` | 2781 | `8ae7c8c7ce022cbb80f049d56aeec5719dfc69cc90ee87c3aed8006454ebc04f` |
| `mcp/image-brand/fixtures.py` | 1731 | `bee4ffeed922dafa6a11c47dfca4ff1c9e647dbf12038cc8cff3d6d31ff1ea44` |
| `mcp/image-brand/mcp-client.mjs` | 296 | `131a4fcb5d60dff790af5ba3aaedd9d919cea7ea96140e73c4d616947925fbd6` |
| `mcp/image-brand/pipeline.py` | 26973 | `8c358d461af230b12a6a05af3696fb320e08d1ad6f6d4101e9dd231f2f433d0c` |
| `mcp/image-brand/README.md` | 9487 | `ff977c0a815c52d7529a18d05422d4c26eeb941aeeca1416181049feb2da3ba5` |
| `mcp/image-brand/selfcheck.mjs` | 3386 | `d57ffb1a1205eaa301eb9d067b10093e51aa3a7f96c61987a16dab12f1a0ae3c` |
| `mcp/image-brand/server.mjs` | 46302 | `732d101c9df2739b3b81e30cb799ac371b4fc93d1ea89421b2fad0157dd60847` |
| `mcp/image-brand/test/image-brand.test.mjs` | 6621 | `c4613c3755ccbdfdd1f34306947fe55bf0b1f14f184c7c0b018772308714176e` |
| `mcp/public-api/README.md` | 4109 | `750438f9e795c5d1676a71eb7495e3e3146180258766445eca8f5f2f51ab1bae` |
| `mcp/public-api/selfcheck.mjs` | 2649 | `cd5083dbd0126e4f641c54f1d715c3ac6c48f6434a87ee5516cc9e3ed226f58f` |
| `mcp/public-api/server.mjs` | 3188 | `709ded85e81ecfb16c9df0650735e22a7bc9327383be133720e72c0e3bd54e3e` |
| `mcp/public-api/sources.mjs` | 17233 | `1d807f81ce5f4b51629f597118a8429541722c0f6d0e9088cf952224f0dc68a4` |
| `mcp/public-api/test/public-api.test.mjs` | 3599 | `eb0ffc399dfab82869c693130792b2da6c911e27126cffc8f4fbd5619c26ebd1` |
| `mcp/shared/client.mjs` | 2609 | `acc65207ae92b58082f2ff1df8570d076c710b5303a6ea7fe51f6ac1a62c088c` |
| `package.json` | 2423 | `f4f20b8075694e69784d1fc28edde566c273d41e2b12cc6c4343aa2c49a41db8` |
| `scripts/allow-always-check.mjs` | 3138 | `514642a97a4f3a3a3f67b68789d8b2e1665680d2623e79d14ba640c6d395c257` |
| `scripts/audit-install.mjs` | 5416 | `171914479782b23b7d19a72b841006865ef9be69e561cbc5a271ef49eb18cf52` |
| `scripts/configure.mjs` | 14570 | `53c62929b01c0cc5bddc1a21935e88790c6f67a8d5b7989711b894a6da0faf18` |
| `scripts/docs-check.mjs` | 779 | `391e4b5f418b6357a67bba6019b2c2818fb3e86889a4eaba0722dc49802917e7` |
| `scripts/e2e-install.mjs` | 14358 | `a6aded4609362a02aa239f8a632d6c02c1fdd61decad1fe7c2054ff7eea3761b` |
| `scripts/e2e-modules.mjs` | 10876 | `ef1396e87669b2e833eae4685974b421266aa988d34d72403c460653e77bfa03` |
| `scripts/identity.mjs` | 4840 | `6cd9ec01f95af6a376745b4db047abd8ae77e5867fd5d6a91a99c82f1033f32d` |
| `scripts/integrity.mjs` | 10479 | `365f6335c685680a0062f86ea27ee3f10c3181662216a5e9d4ac2cc5a149983a` |
| `scripts/lsp-diagnostics.mjs` | 8920 | `9ee3431929bf4fec4e39d822e0a1876380229fda3408b7fa8c2f326a51ab4121` |
| `scripts/lsp-probe.mjs` | 7294 | `77f7d44d6529d2d73376c4ca09053c046d3209af0b90ec1da5fda2335c4fe7ae` |
| `scripts/setup.mjs` | 12807 | `f991bf440bbcd38819a40978e201817004e5574c4c45ed4f4921fa9ec0353d5f` |
| `src/agents.ts` | 13479 | `0e9fc2b22e375579fb2e77d8772717aec58cf31bd0bad91795cbd0dd4b46574e` |
| `src/ethics.ts` | 12748 | `aa323a52c7713398095d1297ce1eca30b7352cdb19d9092b212586516590cd85` |
| `src/generate.ts` | 6924 | `be7e240994d953a8fb8e3864558f6609389e1780556b7182a58a0e21a7827be6` |
| `src/identity.ts` | 11774 | `c604e580cb428f9ae2650dca6fca9434d774861aaa25d5c1aeb0f0a9245d6ce3` |
| `src/install/space.ts` | 3813 | `098fe34dfe34003f1ad66cb1e6aa32f4ef8415bc9d81f198c61776fbd31f4931` |
| `src/plugin.ts` | 79783 | `c31e7f16f521d42608d7771ab06e727dbbf5333faf6a2215465c88464aa30e88` |
| `src/roster.ts` | 48796 | `6cb0fbe77f47cfb9245f764f8fc1c742b890c0bcb84368eeb43114ec6329192a` |
| `src/runtime.ts` | 16105 | `e1c0ed06475af247a55da955b1b2af13966e2c5229081d45de4f742ea14ff80e` |
| `src/zombie/circuitBreaker.ts` | 7589 | `c240197b45c7278721245811e0e2fa423e1081c3afb1d5314bba1f1f4493c1c8` |
| `src/zombie/context.ts` | 16996 | `73caa204d6e71a4a32260c543caacfc1822756d5884ac7bd3cfefc8a96ca67e0` |
| `src/zombie/defaults.ts` | 3489 | `d9219f68b9af5c7d52bb485b892353431be32c105dc55a27a31e26e118a9ffa1` |
| `src/zombie/design.ts` | 13664 | `d47465bf40d7fbe879e6aaa11fc70174406cf6bd85375b5390e2a089af756601` |
| `src/zombie/docsConsistency.ts` | 3826 | `996e71595316da95ffa2db2ba3169d5b47c6655ed214cbaf76215b4980760516` |
| `src/zombie/focus.ts` | 13450 | `83b95b0216e699fda9047cad4ce854de8fd9c22182d174fa800f0f6ff411b14b` |
| `src/zombie/frontmatter.ts` | 10771 | `97a5c91c10c8edf838b7e6d47ad2549874885c0316254c3457434ceff0f07b16` |
| `src/zombie/goalContract.ts` | 12434 | `946acb0f8989548da854cb7439a8e94c39055950479074219610ac1ecb7b280e` |
| `src/zombie/io.ts` | 5006 | `89b3f44e558f7b7d07735a9ac0a1fc3f610794c2ac10f50d3e7cd19b379d5dad` |
| `src/zombie/lsp.ts` | 13112 | `4ad4e476d20812de3f93bb8182d535cd3e1ed2764a8e117083daa9511cb25604` |
| `src/zombie/lspConfig.ts` | 7794 | `afcb29b0335f0d693780057eedb9db4f37310b4dddde1b083d5b972f0bf7f66b` |
| `src/zombie/mcp.ts` | 5564 | `2222d1adb6307c9767ac7392457acd25cf991c9130559825cc5ab383d6503b8a` |
| `src/zombie/mcpConfig.ts` | 3171 | `75b82836105f6d2fe16a42d90c2de5c72efd7043b5e5f127243f6769e15baaf8` |
| `src/zombie/memory.ts` | 13665 | `6b2a6a52ad2965b37bfcc605872baef24f2701619835d96a3c6677dd1b3c7973` |
| `src/zombie/models.ts` | 18746 | `e63f8dbfb085c7eb1f89af41db7c6ed0e2a51df730348cfabd055a9c907004e8` |
| `src/zombie/modes.ts` | 11052 | `b23eb59b3c27ffc147f702ba99cfc01e28eedb478ceef45c81cacd9ae4f8efc5` |
| `src/zombie/onboarding.ts` | 13844 | `7ee49c13c790326ae8d148e5a5ece209fa0a1c145ddd544b5e69a085ae7e1591` |
| `src/zombie/opencodeRuntime.ts` | 3884 | `1a4e01058f31e2cbfea9a1bfa456944fec8e70c9f338249b2033cf0d19cd14d9` |
| `src/zombie/origin.ts` | 5116 | `6b37139ebcf59a436a05e3fb3eb28be4ad4aa195a099fe388faab9030d73567c` |
| `src/zombie/paths.ts` | 4069 | `5c112f868245e5ea52f8db0b4f397579d05fda008b0f30fa750267846d3de77c` |
| `src/zombie/responseGate.ts` | 33671 | `e279e70d3ea5b164ee1c6feee880187d6657c7904fe13c932ceb0aa71260c6a2` |
| `src/zombie/runnerIdentity.ts` | 7631 | `7926e5533c287e0f757acd15623d4f0825a6eefa488379243059fd1f8ad659bc` |
| `src/zombie/sanitize.ts` | 2173 | `d8fe339c61516c679ed35bbfe234375f977b7aff5673e375b4862ce8a15dc7ac` |
| `src/zombie/scan.ts` | 7562 | `9a9b657954f86a7f758a0d1fe17523a9d4c8496803c1e72017c3a7ce88116ade` |
| `src/zombie/server.ts` | 67968 | `81efaf3f25ad4967065ec2987f9cc7cf267d1e397e347ad3899767702823c886` |
| `src/zombie/skillCatalog.ts` | 23862 | `853d3353d8837eecb19731603f23f9fc2aaa71a50b12fbcae99af7db844ae7ab` |
| `src/zombie/skills.ts` | 5815 | `0140442c49dfbe9ad7d02db80d310e314f5e126d9441dd33c4d6371894cba3d3` |
| `src/zombie/ssot.ts` | 6978 | `8a6086ac0c5a410895c5370485d71d799906e1c52cca6f9e46ca33865f67ea6f` |
| `src/zombie/syllabus.ts` | 11362 | `b78cfb409934296a4c7724a61077f040c1992a48464113a83f91756669054156` |
| `src/zombie/transform.ts` | 3964 | `1c25f3eb1f6ecc9c8ed68b9894f2dfcffb75e233540be06b81f8bda78cc11ba2` |
| `test/audit-install.test.ts` | 4155 | `78ac9b2a258dba24cc55474ec8d03baf2ef4c66d1797e272717c0b369cfd8d44` |
| `test/circuitBreaker.test.ts` | 4791 | `83dff617538d24745fb23cb9fad77dc9dac9254361c6b579a9f7f1baafe9471e` |
| `test/context.test.ts` | 34868 | `66d0f69426abbad6c1a3ea82534d72daf43a29ba7fd48bb8289baa70b9b1611b` |
| `test/design.test.ts` | 4746 | `a1995cf09d563b94713a23f73d9c5ff3330f45c96125dc7cc908b361736f0c2e` |
| `test/docs.test.ts` | 2157 | `d2b97395a5ab3b7710350d778e2b76857d740caf978842da5126efdc09fd94e2` |
| `test/focus.test.ts` | 4051 | `47d93d65959c80c0b1ebb99b7cc5445d5dfbef536c9d3bc51bc90937b0e8b3a1` |
| `test/footprint.test.ts` | 2690 | `6c053dfca81fe65da03e216d72bea79abbd015ec73f2f714aeb1769db705b8e3` |
| `test/frontmatter.test.ts` | 3204 | `5b20743b544ef7c3be3f77c3d9377f577c31a1f30fadc9462a4ad22760ddadc2` |
| `test/goalContract.test.ts` | 6132 | `dea761050c5caed15f362072f43cdf2b505e36b239bab28a80961c37f1b2e5ae` |
| `test/identity.test.ts` | 3944 | `ee835ab860ef3efd03cc9f2eefdba10fdeeda791e2f18b1453fa6f1e75fc03fe` |
| `test/install.test.ts` | 31123 | `9541241229bb80b7552ef22ab6f4077caa7f43e80d702e5878eab45e2435acb9` |
| `test/installSpace.test.ts` | 2234 | `8d589c1d8e2423869c788c11435e0fc23be6abc5145d7b66c9fb54cc09671c71` |
| `test/io.test.ts` | 959 | `c483a9c9f9a4ca51e595df125fb36a8a23627a331ac9fbe871f1c404f858fe4a` |
| `test/lsp.test.ts` | 2276 | `e6808cbdb5df0d78dd645b1b5a0e73ce64029eb2aa0e09516e585e523b673a6a` |
| `test/lspConfig.test.ts` | 5170 | `074bd54fd9163aaaa1ccdf9cbe6b647ca0c60e150cccb2553cd42330996f8952` |
| `test/mcp.test.ts` | 2352 | `b4ccdef6695d1b05082cd6ea7a1003f692daf606913e9456be1eca2c61e98fb7` |
| `test/mcpConfig.test.ts` | 2758 | `94cdd10740d1f736a34adeecd443460a038c018ecfb0edea53aeb11f40d6dcf5` |
| `test/memory.test.ts` | 6858 | `9c3f52764efacf803a5a86ba3d69cee383cd015393f62e918f8f7e9e8ab8f296` |
| `test/memoryDialogue.test.ts` | 2579 | `fc4381fc4b296b1c9b527115d3558e3ce56fff4fba4aa12e572c79e088fc8d24` |
| `test/models.test.ts` | 14604 | `53563913d22a1fe16149511df4a95e4f0ec3e2e78c4f2992fa33507e98ab2950` |
| `test/modes.test.ts` | 4947 | `1d632c8eaaa2fbbf55c108f23fc0f2cf20d50ece4bd59b29201d96cb37594d1f` |
| `test/onboarding.test.ts` | 6117 | `9e45cc4cbeaed79e4f5644f28d4faea87ee34152e96972973c93774c9ae344ae` |
| `test/opencodeRuntime.test.ts` | 3366 | `bf0c644e9ffe3e572d49c3e2ccab99cf752e88f27cd4b9cf4596ddbc16434fdd` |
| `test/origin.test.ts` | 4002 | `d75f26822785389c2c9a3b1213c74555ced930c374797d2e702c80fad6788b9f` |
| `test/plugin.test.ts` | 70223 | `107657ce31318a627a1155c26e810b42910c7d4d5f4f5a911ab66821c3badc68` |
| `test/repo.test.ts` | 2891 | `dfe11cfde7963d84f580a12d49c6acbf81494a9087e4dbe1c04ebca4e9c0427e` |
| `test/roster.test.ts` | 2895 | `4c2d42977c3ecf1ab57342771628e91e963449c21d95c9fbd8689be92cf022a1` |
| `test/runnerIdentity.test.ts` | 4145 | `0a0bbe76c848d5c43bab93165cdc7cfbf5a1d813f75e063e1678ced8792738c9` |
| `test/sanitize.test.ts` | 1479 | `3007467c56d4af5e853e60ec08cddbeaf4f7f9281822cf8f1199e1618d7ae870` |
| `test/skillCatalog.test.ts` | 9051 | `ac93c08c7a44cb36cf4d46742c0f0b19362ea873447d52737ec8f840c36460c2` |
| `test/tools.test.ts` | 5560 | `74eee0129d493f99d50af154ebc7ddc12cb897346acaeb9ee5a9e3f982af2c89` |

## Footer

এই manifest-টা নিজে hash-এ ধরা নেই। ফুটারের root hash বদলালে
`npm run integrity` চালিয়ে regenerate করুন।
