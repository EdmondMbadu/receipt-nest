from pathlib import Path
import re,urllib.request
root=Path(__file__).resolve().parents[1]/'assets'
for block in (root/'brand-fonts.css').read_text().split('@font-face')[1:]:
 name=re.search("font-family: '([^']+)'",block).group(1).replace(' ','-')
 weight=re.search('font-weight: (\\d+)',block).group(1)
 url=re.search(r'url\(([^)]+)\)',block).group(1)
 urllib.request.urlretrieve(url,root/f'{name}-{weight}.ttf')
 print(name,weight)
