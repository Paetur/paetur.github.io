# Projects & references

Three small web projects, hosted at **https://github.notin.fo/**.

| Project | Open |
|---|---|
| **iPhone Atlas** | [Compare iPhone models, features and specifications](https://github.notin.fo/iphone/) |
| **HK-bussar** | [Explore fleet specifications and measurement evidence](https://github.notin.fo/hk-bussar/) |
| **RSVP Manager** | [Project overview, progress and releases](https://github.notin.fo/rsvp-overview/) |

RSVP Manager software and documentation: [Paetur/RSVP-Manager](https://github.com/Paetur/RSVP-Manager).

## Build and preview

Requires Python 3 and Node.js. No package installation is needed.

```bash
python3 tools/build_site.py
node tests/verify.cjs
python3 -m http.server 8000 --directory _site
```

Open `http://localhost:8000/`. The generated `_site/` directory contains the complete public website.

## Update the projects

- iPhone Atlas: edit `projects/iphone/build.py` or its HTML template. Model records and source links are preserved in the generated catalogue.
- HK-bussar: edit `projects/hk-bussar/index.html`. Keep measurement evidence and provisional-value notes with the data.
- RSVP Manager overview: edit the deliberately public snapshot in `projects/rsvp-overview/data.json` or its template. Scores describe development estimates, not test coverage or a specific installation.
- Home page: edit `index.html` and `assets/site.css`.

Push to `main` to validate and deploy automatically with GitHub Actions. You can also run **Actions → Deploy projects → Run workflow**. Only `_site/` is uploaded to GitHub Pages.

## Domain

GitHub Pages serves `github.notin.fo` with HTTPS enforcement. DNS uses the CNAME `github.notin.fo` → `paetur.github.io`. The root `CNAME` records the intended domain; repository Pages settings provide the custom-domain binding for Actions deployments.
