import re,json,html
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urljoin
root=Path(__file__).resolve().parents[1]
items=[]
for site_name,base,css in [('趁手','https://tools.hzcmzhfw.cn/','tool-card'),('轻办','https://qingban.hzcmzhfw.cn/','tool-row')]:
 source=urlopen(base).read().decode()
 for attrs,body in re.findall(r'<a\b([^>]+)>(.*?)</a>',source,re.S):
  if css not in attrs:continue
  href=re.search(r'href="([^"]+)"',attrs)
  title=re.search(r'<h3>(.*?)</h3>',body,re.S) if site_name=='轻办' else re.search(r'<div class="nm">(.*?)</div>',body,re.S)
  desc=re.search(r'<p>(.*?)</p>',body,re.S) if site_name=='轻办' else re.search(r'<div class="ds">(.*?)</div>',body,re.S)
  if not href or not title:continue
  text=title[1]
  text=re.sub(r'<span\b.*?</span>','',text,flags=re.S)
  clean=lambda s:html.unescape(re.sub('<[^>]+>','',s)).strip()
  url=urljoin(base,html.unescape(href[1]))
  if any(x['tool_url']==url for x in items):continue
  items.append(dict(tool_id=str(len(items)+1),tool_name=clean(text),tool_desc=clean(desc[1]) if desc else '',tool_url=url,site_name=site_name))
(root/'extension/catalog.json').write_text(json.dumps(items,ensure_ascii=False,indent=2))
print('目录生成：',len(items),'项')
