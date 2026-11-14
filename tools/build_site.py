"""Build the three public projects without reading installation or account configuration."""
from pathlib import Path
import json,shutil,subprocess
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'_site'
if OUT.exists():shutil.rmtree(OUT)
OUT.mkdir()
for name in ['index.html','CNAME','.nojekyll']:shutil.copyfile(ROOT/name,OUT/name)
shutil.copytree(ROOT/'assets',OUT/'assets')
subprocess.run(['python3','build.py'],cwd=ROOT/'projects/iphone',check=True)
shutil.copytree(ROOT/'projects/iphone/dist',OUT/'iphone')
(OUT/'hk-bussar').mkdir();shutil.copyfile(ROOT/'projects/hk-bussar/index.html',OUT/'hk-bussar/index.html')
nav='<nav aria-label="Projects" style="max-width:1650px;margin:auto;padding:18px 24px 0;font:14px system-ui"><a href="../" style="color:inherit">← Projects</a></nav>'
for name in ['iphone','hk-bussar']:
 p=OUT/name/'index.html';s=p.read_text();assert '<main' in s
 s=s.replace('<main',nav+'<main',1);p.write_text(s)
data=json.loads((ROOT/'projects/rsvp-overview/data.json').read_text())
assert set(data)=={'project','updatedAt','assessmentDate','release','sourceURL','releaseURL','maturity','readiness','modules','next','developmentStatus','completedMilestones'}
assert all(set(row)=={'name','progress'} for row in data['modules'])
encoded=json.dumps(data,ensure_ascii=False).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
page=(ROOT/'projects/rsvp-overview/template.html').read_text().replace('/*DATA*/',encoded)
(OUT/'rsvp-overview').mkdir();(OUT/'rsvp-overview/index.html').write_text(page)
(OUT/'rsvp-overview/data.json').write_text(json.dumps(data,indent=2)+'\n')
print('Built iPhone Atlas, HK-bussar and RSVP Manager overview into _site/.')
