## [2.3.0](https://github.com/Arcadoolic/maui/compare/2.2.0...2.3.0) (2026-09-19)

### Features

* **maui:** polish the hiscores table (top 9, category label behind it, empty message) ([e70a737](https://github.com/Arcadoolic/maui/commit/e70a7373b4ea651cbed397d650f722726b2f1932))

### Bug Fixes

* **bo:** match the CI prerelease tag in the running version ([392439a](https://github.com/Arcadoolic/maui/commit/392439a82c1efa69a9709ce98a5dc4935362e28c)), closes [#33](https://github.com/Arcadoolic/maui/issues/33)
* **deps:** keep umzug on runtime require() in the renderer and ship it as a dependency ([92c41ab](https://github.com/Arcadoolic/maui/commit/92c41abb5aeba26d4d138340f439d454fa1fa6dd)), closes [#48](https://github.com/Arcadoolic/maui/issues/48)
* **deps:** revert vite-plugin-electron-renderer and electron-log majors that broke the front ([3b5e75b](https://github.com/Arcadoolic/maui/commit/3b5e75b569289a4b668fb9e132ffc1370ccf5abb))

## [2.2.0](https://github.com/Arcadoolic/maui/compare/2.1.1...2.2.0) (2026-09-18)

### Features

* add standalone Python script to import a starting pack ([4587b10](https://github.com/Arcadoolic/maui/commit/4587b105e2d28aca1dee9ad0be1980b391da62aa))
* **bo:** add basic gamepad/joystick device detection on Manettes tab ([639d7b8](https://github.com/Arcadoolic/maui/commit/639d7b8fb33946a0c30cc495501248ab4812f296))
* **bo:** add favorites.ini deletion to MAME's danger zone ([f4dec8e](https://github.com/Arcadoolic/maui/commit/f4dec8ecd4bd655d58d08f4c6e9187d61106bc32))
* **bo:** browse and import starting packs from repo.maui.afronob.com ([c24bf70](https://github.com/Arcadoolic/maui/commit/c24bf70160f65cbf37119ba589a716f782618f94))
* **bo:** capture a gamepad press and bind it to UI_CANCEL (quit MAME) ([f55ef8c](https://github.com/Arcadoolic/maui/commit/f55ef8cefd11a076b0f1a6f08f0ed437da7a1034))
* **bo:** explicit start/stop MAME session for gamepad remap captures ([e3e80e4](https://github.com/Arcadoolic/maui/commit/e3e80e47da7bf1ba7ddea9a15a43b7874083179a))
* **bo:** fix the update list order, show the running version, keep progress logs scrolled ([f7f910a](https://github.com/Arcadoolic/maui/commit/f7f910a0f117a8777a850bd2477b8d10442a1ac7))
* **bo:** found/not-found icons on MAME info, fix Enter on login ([79b7a04](https://github.com/Arcadoolic/maui/commit/79b7a04767436327b94493ddf5c7ce99f3f2e083))
* **bo:** generalize remap card and show persisted state per action ([ced71cc](https://github.com/Arcadoolic/maui/commit/ced71ccdf89f7922de56921d65815b30329464a1))
* **bo:** list MAUI's own controls and their role in the MAUI tab ([1ad5ab1](https://github.com/Arcadoolic/maui/commit/1ad5ab17939ddfa29417e3a6797c1fffc241f0fd))
* **bo:** plugin.ini found-check, fix stale ci-dessus/ci-dessous refs ([dfc3acd](https://github.com/Arcadoolic/maui/commit/dfc3acdc59a82e2403cc2ea1acce1b2c707c5ffd))
* **bo:** publish develop prereleases instead of PR build artifacts ([e268230](https://github.com/Arcadoolic/maui/commit/e268230c4eab2f32512678c50f9000e2bb7fbcf2))
* **bo:** remap card table layout + P1 directions/buttons ([91e2bf4](https://github.com/Arcadoolic/maui/commit/91e2bf43295050633b7ff52d650498e2d8cf1857))
* **bo:** self-update the Pi cabinet from GitHub Releases in the BO ([25ce766](https://github.com/Arcadoolic/maui/commit/25ce7666a03d6e137b78bb3d19fb71e48952f630))
* **bo:** stop dead-ending on actions, add feedback and per-tab subnav ([ae780f1](https://github.com/Arcadoolic/maui/commit/ae780f1c3877e0f7a55103ca76fee5a46be69d32))
* **config:** add repoUrl/repoUser/repoPassword fields ([88a70d8](https://github.com/Arcadoolic/maui/commit/88a70d8caee359a0d00ef95967a2d77762f18e98))
* **maui:** map Space and P to buttons 1 and 2 on the standard gamepad layout ([bfd643e](https://github.com/Arcadoolic/maui/commit/bfd643e9bfd9fad0eb5a9aac75dbc8248c599495))
* **scripts:** add --url mode to import-starting-pack.py ([36a065b](https://github.com/Arcadoolic/maui/commit/36a065be69742edab295d8e1988ae6be8f9d079d))
* **scripts:** add generate-repo-manifests.py for repo.maui.afronob.com ([e62af6d](https://github.com/Arcadoolic/maui/commit/e62af6d92fe35e953667ac731971dcbc8823a295))

### Bug Fixes

* **bo:** gate MAME-launching routes on the admin role instead of localhost ([d1b53ba](https://github.com/Arcadoolic/maui/commit/d1b53ba9c2ffd3af180ba63af080804261876850))
* **bo:** keep BO self-update swap on one filesystem and roll back on failure ([1c2c7f2](https://github.com/Arcadoolic/maui/commit/1c2c7f20332023f5c5666eb8eb3bf881c0444476))
* **bo:** recognize Windows absolute paths in resolveDirectoryPath ([f5c53c2](https://github.com/Arcadoolic/maui/commit/f5c53c2f31e21a7dfeba2ce14a1a5188fa19e7f3))
* **bo:** release a remapped button from MAME's in-game UI menu binding ([5361abf](https://github.com/Arcadoolic/maui/commit/5361abf21a570366e89f9ffb5279f38b68571d6e))
* **bo:** reopen the subtab a form response is actually about ([809c826](https://github.com/Arcadoolic/maui/commit/809c82626ad2eda5779ace775496b2fca4634adb))
* **bo:** stop checkbox-row text fragmenting into a ragged multi-line wrap ([2f87217](https://github.com/Arcadoolic/maui/commit/2f87217bac500e806e6c044c66d3c9b7bcf24f15))
* **ci:** install Python 3.11 for the windows-x64 build job ([efa46ac](https://github.com/Arcadoolic/maui/commit/efa46acc2f0f425d1c33b8ca23ce181e7401ccfd))
* **db:** seed bo_user before the MAME-config gate so the BO can log in ([2ff4192](https://github.com/Arcadoolic/maui/commit/2ff41927857b402236728229d017385f9ec77c29))
* **hiscore:** use a junction instead of a symlink for hi -> hiscore on Windows ([ab3de30](https://github.com/Arcadoolic/maui/commit/ab3de30a28232c8a731ac86c686114fa9c0453db))
* **import-starting-pack:** avoid re.sub bad-escape crash on Windows home paths ([426e8d6](https://github.com/Arcadoolic/maui/commit/426e8d6a106ec3b7d08ff152a326eb7c7784fbbc))
* **justfile:** default ARTIFACT_SUFFIX so `just build` works outside CI ([fa2809e](https://github.com/Arcadoolic/maui/commit/fa2809e4dfb28cb5fcd7e94926b8f213afee60f5))
* **ui:** apply the windowed 1280x720 default size in production too ([eacfba2](https://github.com/Arcadoolic/maui/commit/eacfba2e2c9a06a87b7132e07024a81f5d6c234d))
* **ui:** fix category icon class name for multi-word/TTL genre.ini names ([4e0b3bf](https://github.com/Arcadoolic/maui/commit/4e0b3bf270750b184d1a70c7c23166992405a523))
* **ui:** order games within a category the same as the full list ([7011400](https://github.com/Arcadoolic/maui/commit/7011400d09b3f548ed99ceae7311abb6605c6ded))
* **ui:** use pathToFileURL for flyer/marquee/logo image URLs ([1a17a38](https://github.com/Arcadoolic/maui/commit/1a17a38ef986c7d68e3cd50a0c3f0398929c0451))

## [2.1.1](https://github.com/Arcadoolic/maui/compare/2.1.0...2.1.1) (2026-09-17)

### Bug Fixes

* **ci:** attach release artifact in the same workflow run ([a34350b](https://github.com/Arcadoolic/maui/commit/a34350b718dad0e2bc28726833a475025a9bf456))

## [2.1.0](https://github.com/afronob/maui/compare/2.0.2...2.1.0) (2026-09-17)

### Features

* **bo-server:** add login/session auth with per-account password change ([ba795d3](https://github.com/afronob/maui/commit/ba795d3b33b6cd94e687b1e7d612112e48b5a40f))
* **bo-server:** restrict destructive/backup modules to the admin role ([fd0ef20](https://github.com/afronob/maui/commit/fd0ef20cf7878acd804168b3ec24bcc519a63ca4))

### Bug Fixes

* **database:** package migrations inside app.asar ([c2fe565](https://github.com/afronob/maui/commit/c2fe5656fa116994e0c4dfb3eb9f9782b5ab3764))

## [2.0.2](https://github.com/afronob/mame-awesome-ui/compare/2.0.1...2.0.2) (2026-09-15)

### Performance Improvements

* **games:** virtualize the games list and defer costly rendering ([9e8d1b6](https://github.com/afronob/mame-awesome-ui/commit/9e8d1b6fbdb230dcd4e3b3c0981d361df223c0f3))

## [2.0.1](https://github.com/afronob/mame-awesome-ui/compare/2.0.0...2.0.1) (2026-09-15)

### Bug Fixes

* **ci:** pin conventional-changelog-conventionalcommits to ^9.3.1 ([a420cd7](https://github.com/afronob/mame-awesome-ui/commit/a420cd774542f7838b5bbeccfe1e04d88428aebb))
