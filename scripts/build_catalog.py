"""Generate a bundled, stable-URL tool catalog from the two public homepages."""
import html
import json
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
SITES = [
    ('趁手', 'https://tools.hzcmzhfw.cn/', 'tool-card'),
    ('轻办', 'https://qingban.hzcmzhfw.cn/', 'tool-row'),
]


def clean(value):
    return html.unescape(re.sub('<[^>]+>', '', value)).strip()


def build():
    items, seen = [], set()
    for site_name, base, css in SITES:
        with urlopen(base, timeout=20) as response:
            source = response.read().decode('utf-8')
        site_count = 0
        for attrs, body in re.findall(r'<a\b([^>]+)>(.*?)</a>', source, re.S):
            if css not in attrs:
                continue
            href = re.search(r'href="([^"]+)"', attrs)
            title_pattern = r'<h3>(.*?)</h3>' if site_name == '轻办' else r'<div class="nm">(.*?)</div>'
            desc_pattern = r'<p>(.*?)</p>' if site_name == '轻办' else r'<div class="ds">(.*?)</div>'
            title, desc = re.search(title_pattern, body, re.S), re.search(desc_pattern, body, re.S)
            if not href or not title:
                continue
            url = urljoin(base, html.unescape(href[1]))
            parsed = urlparse(url)
            if parsed.scheme != 'https' or parsed.netloc != urlparse(base).netloc or url in seen:
                continue
            seen.add(url)
            name = clean(re.sub(r'<span\b.*?</span>', '', title[1], flags=re.S))
            if not name:
                raise ValueError(f'工具名称为空：{url}')
            keywords = re.search(r'data-kw="([^"]*)"', attrs)
            items.append({
                'tool_id': url, 'tool_name': name, 'tool_desc': clean(desc[1]) if desc else '',
                'tool_url': url, 'site_name': site_name, 'tool_keywords': clean(keywords[1]) if keywords else '',
            })
            site_count += 1
        if site_count < 50:
            raise ValueError(f'{site_name}仅解析到 {site_count} 项，页面结构可能改变，原目录未覆盖')
        print(f'{site_name}：{site_count} 个去重入口')
    destination = ROOT / 'extension/catalog.json'
    destination.write_text(json.dumps(items, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'目录生成：{len(items)} 项')


if __name__ == '__main__':
    build()
