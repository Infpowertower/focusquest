# FocusQuest

A to-do and Jira ticket board that rewards you for getting things done (XP, levels, streaks, badges). Built for Windows 11 PCs where you cannot install software: it needs no admin rights and uses only what ships with Windows (Windows PowerShell 5.1 and a browser).

## Install

1. Download `FocusQuest-<version>.zip` from the [latest release](https://github.com/Infpowertower/focusquest/releases/latest).
2. Right-click the zip file, choose **Properties**, tick **Unblock** and click OK. Company PCs often refuse scripts from a zip file that is still marked as downloaded ("is not digitally signed").
3. Extract the zip.
4. Double-click `Install-FocusQuest.cmd`. It copies the app to `%LOCALAPPDATA%\FocusQuest`, adds a **FocusQuest** entry to the Start menu and starts the app.

`README.txt` inside the zip explains everyday use and the Jira connection.

## Update

FocusQuest asks GitHub once a day for the newest release (this can be switched off in Settings). When there is one, a quiet line appears at the bottom left; click it to read what is new and install it. The helper downloads the release zip from this repository only, checks its SHA-256 sum, takes only the known program files out of it, keeps the previous version in `data\update\previous`, and restarts. Nothing is installed without your click.

The checksum catches a damaged download. It does not protect against a compromised GitHub account, because zip and checksum come from the same place.

## Without the helper

If your PC only runs signed PowerShell scripts (execution policy `AllSigned`), or you only need the to-dos, double-click `app.html` from the zip. Jira is switched off in this mode, because a web page cannot call Jira Data Center without the helper, and the data is kept in the browser rather than in a file. The same page can be published as an installable, offline-capable website: switch on GitHub Pages with source "GitHub Actions" and the workflow deploys it.

## How it works

`Start-FocusQuest.cmd` starts `server.ps1`, a small helper that listens on `http://localhost:8765/` only. It serves the app (a single self-contained `app.html`), keeps your data in a `data` folder next to it, and relays REST calls to your Jira Data Center with a personal access token that never reaches the browser.

## Build

```bash
node dev/build.js --web     # writes app.html and site/
node dev/run-tests.js       # browser tests against a mock Jira, needs playwright
```

The build inlines `src/` into `app.html` and writes the browser version to `site/`. Every push is built and tested: the browser tests on Linux, and installer, helper and in-app update on Windows PowerShell 5.1 (`dev/test-helper.ps1`). A push to `main` then publishes the browser version to GitHub Pages, and publishes a release named `<VERSION>.<run number>`; raise the number in `VERSION` for a new major or minor version.

## License

[MIT](LICENSE). FocusQuest is not affiliated with or endorsed by Atlassian. Jira is a trademark of Atlassian.
