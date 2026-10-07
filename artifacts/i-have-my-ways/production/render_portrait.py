"""Re-edit the real animated footage for a 1080x1920 phone composition.

Dialogue/music stay on the existing 60-second master clock. Close-ups are cut
on speaking turns. Product inserts are laid out natively for portrait.
"""
from pathlib import Path
import argparse, json, math, subprocess
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'exports'
QA = ROOT / 'production/qa'
FF = '/private/tmp/receiptnest-caption-bin/ffmpeg'
W, H, FPS = 1080, 1920, 24
INK = (27, 59, 44)
GREEN = (58, 113, 70)
MUTED = (105, 120, 107)
CREAM = (250, 247, 239)
FONTROOT = Path('/System/Library/Fonts/Supplemental')
FONTS = {}
def font(size, weight='regular'):
    key = size, weight
    if key not in FONTS:
        FONTS[key] = ImageFont.truetype(str(FONTROOT / {
            'regular': 'Arial.ttf', 'bold': 'Arial Bold.ttf',
            'serif': 'Georgia.ttf'}[weight]), size)
    return FONTS[key]

def ease(p):
    p = max(0, min(1, p))
    return p*p*(3-2*p)

def centered(d, text, y, size, fill=INK, weight='regular'):
    f = font(size, weight)
    d.text(((W-d.textlength(text, font=f))/2, y), text, font=f, fill=fill)

def check(d, x, y, r=34):
    d.ellipse((x-r, y-r, x+r, y+r), fill=GREEN)
    d.line((x-r*.45,y,x-r*.1,y+r*.32,x+r*.49,y-r*.36),
           fill='white', width=max(4,int(r*.16)), joint='curve')

def card_base():
    im = Image.new('RGB',(W,H),CREAM)
    d = ImageDraw.Draw(im)
    d.ellipse((-430,-510,810,750),fill=(229,237,220))
    d.ellipse((630,1410,1500,2360),fill=(239,222,204))
    d.text((88,250),'ReceiptNest',font=font(40,'bold'),fill=GREEN)
    return im, d

def graphic(kind, p):
    im,d = card_base()
    if kind == 'monthly':
        d.rounded_rectangle((65,362,990,1402),radius=42,fill='white')
        d.text((108,411),'MARCH 2026',font=font(30,'bold'),fill=GREEN)
        d.text((108,485),'Spent this month',font=font(42),fill=INK)
        d.text((104,566),'$2,961.40',font=font(108,'bold'),fill=INK)
        d.text((108,714),'Every receipt. A clearer picture.',font=font(31),fill=MUTED)
        data=[('Supplies','$1,240',1),('Gas & Fuel','$612',612/1240),
              ('Client meals','$188',188/1240),('Other','$921.40',921.4/1240)]
        for i,(label,value,amount) in enumerate(data):
            y=833+i*128
            d.text((111,y),label,font=font(34,'bold'),fill=INK)
            f=font(33)
            d.text((930-d.textlength(value,font=f),y),value,font=f,fill=INK)
            d.rounded_rectangle((111,y+54,930,y+75),radius=10,fill=(222,229,217))
            progress=amount*ease(p*2.2-i*.11)
            if progress>.005:
                d.rounded_rectangle((111,y+54,111+819*progress,y+75),radius=10,fill=GREEN)
        centered(d,'CAPTURE  ·  ORGANIZE  ·  FIND',1450,27,GREEN,'bold')
    elif kind == 'receipt':
        centered(d,'Found it.',399,92,INK,'serif')
        centered(d,'The original receipt.',527,39)
        centered(d,'Still clear. Still there.',585,35,MUTED)
        d.rounded_rectangle((130,712,950,1435),radius=38,fill='white',outline=(220,225,215),width=2)
        d.text((183,761),'TOOL DEPOT',font=font(45,'bold'),fill=INK)
        d.text((184,831),'Original receipt',font=font(29),fill=MUTED)
        d.line((183,896,897,896),fill=(223,229,220),width=2)
        d.text((183,946),'18V Drill Kit',font=font(39),fill=INK)
        d.text((179,1020),'$129.00',font=font(88,'bold'),fill=INK)
        d.text((184,1135),'Mar 4, 2026',font=font(31),fill=MUTED)
        for i in range(56):
            x=184+i*12
            d.rectangle((x,1220,x+3+(i%4),1300),fill=INK)
        check(d,218,1370,23)
        d.text((258,1351),'RECEIPT SAVED',font=font(27,'bold'),fill=GREEN)
    elif kind == 'email':
        centered(d,'Ready for your',397,73,INK,'serif')
        centered(d,'accountant.',493,73,INK,'serif')
        d.rounded_rectangle((79,687,979,1363),radius=40,fill='white')
        d.text((128,739),'MAIL',font=font(25,'bold'),fill=MUTED)
        d.line((129,801,930,801),fill=(223,229,220),width=2)
        d.text((130,841),'To: our accountant',font=font(37),fill=INK)
        d.text((130,918),'Business receipts — ready for you',font=font(35,'bold'),fill=INK)
        d.rounded_rectangle((126,1010,931,1172),radius=23,fill=CREAM)
        d.rounded_rectangle((149,1041,227,1139),radius=11,fill=GREEN)
        d.text((158,1074),'PDF',font=font(26,'bold'),fill='white')
        d.text((255,1037),'2026_receipts.pdf',font=font(40,'bold'),fill=INK)
        d.text((257,1103),'Jan – Dec  ·  214 receipts',font=font(29),fill=MUTED)
        check(d,161,1260,31)
        d.text((214,1233),'Sent',font=font(45,'bold'),fill=INK)
        centered(d,'PDF export with ReceiptNest Pro',1424,28,MUTED)
    elif kind == 'endcard':
        im=Image.new('RGB',(W,H),'white');d=ImageDraw.Draw(im)
        logo=Image.open(ROOT.parents[1]/'src/assets/receipt-nest.png').convert('RGB')
        logo.thumbnail((410,298),Image.Resampling.LANCZOS)
        im.paste(logo,((W-logo.width)//2,345))
        centered(d,'ReceiptNest',711,77,GREEN,'bold')
        centered(d,'Just snap.',846,106,INK,'serif')
        centered(d,'Less paperwork.',1043,46,MUTED)
        centered(d,'More life.',1105,46,MUTED)
        centered(d,'Start free  ·  iOS & Android',1267,36,INK,'bold')
        centered(d,'receipt-nest.com',1354,53,GREEN,'bold')
        centered(d,'CSV export included · PDF with Pro',1484,27,MUTED)
        if p < .22:
            im=Image.blend(Image.new('RGB',(W,H),'white'),im,ease(p/.22))
    return im

# Each source range is explicitly tied to the existing timeline. Raw clips have
# no old landscape text/captions; the montage has the tracked phone composites.
SOURCES={
    'opening':'01-opening-kling-take01.mp4',
    'pickup':'02-store-capture-PICKUP.mp4',
    'store':'02-store-kling-take01.mp4',
    'habit':'02-habit-montage-COMPOSITED.mp4',
    'monthly':'03-living-room-kling-take01.mp4',
    'garage':'04-garage-kling-take01.mp4',
    'coffee':'05-coffee-veo-take01.mp4',
    'dinner':'06-dinner-kling-take01.mp4',
}
# start, end, source, source-in, crop-left, gentle tracking end, mode
SHOTS=[
 (0,3.5,'opening',0,155,165,'close'),
 (3.5,5.75,'opening',3.5,630,640,'close'),
 (5.75,8,'opening',5.75,155,160,'close'),
 (8,9.25,'pickup',0,355,355,'detail'),
 (9.25,11.79,'store',1.25,183,193,'close'),
 (11.79,14,'store',3.79,520,525,'close'),
 (14,15.333333,'habit',0,405,405,'detail'),
 (15.333333,16.666667,'habit',1.333333,355,355,'detail'),
 (16.666667,18,'habit',2.666667,380,380,'detail'),
 (18,19.5,'monthly',0,160,165,'close'),
 (19.5,23.208333,'monthly',1.5,672,680,'close'),
 (23.208333,25.208333,'monthly',0,0,0,'graphic'),
 (25.208333,26.333333,'monthly',5.208333,170,170,'close'),
 (26.333333,28,'monthly',6.333333,676,679,'close'),
 (28,31.416667,'garage',0,175,177,'close'),
 (31.416667,32.25,'garage',3.416667,526,530,'close'),
 (32.25,35.25,'receipt',0,0,0,'graphic'),
 (35.25,37,'garage',4.25,175,175,'close'),
 (37,37.875,'coffee',0,607,610,'close'),
 (37.875,40.375,'coffee',.875,180,185,'close'),
 (40.375,41.333333,'coffee',3.375,610,610,'close'),
 (41.333333,45,'coffee',4.333333,180,185,'close'),
 (45,47.291667,'dinner',0,635,635,'close'),
 (47.291667,49,'dinner',2.291667,190,195,'close'),
 (49,52,'email',0,0,0,'graphic'),
 (52,54.291667,'dinner',4,637,637,'close'),
 (54.291667,56,'dinner',6.291667,170,170,'close'),
 (56,60,'endcard',0,0,0,'graphic'),
]
SHOTS=[{'start':round(a*FPS),'end':round(b*FPS),'source':s,
        'source_in':round(si*FPS),'x0':x0,'x1':x1,'mode':mode}
       for a,b,s,si,x0,x1,mode in SHOTS]
assert SHOTS[0]['start']==0 and SHOTS[-1]['end']==60*FPS
assert all(a['end']==b['start'] for a,b in zip(SHOTS,SHOTS[1:]))
LABELS=[(0,2.1,'TAX SEASON. LATE.'),(8,9.25,'NEXT MORNING'),
        (18,19.5,'MONTH END'),(28,29.8,'SATURDAY'),
        (37,38.7,'A WEEK LATER'),(45,46.4,'NEXT TAX SEASON')]

class Reader:
    def __init__(self): self.caps={};self.positions={}
    def frame(self, name, index):
        if name not in self.caps:
            self.caps[name]=cv2.VideoCapture(str(ROOT/'footage'/SOURCES[name]))
            self.positions[name]=0
        c=self.caps[name]
        if self.positions[name]!=index:
            c.set(cv2.CAP_PROP_POS_FRAMES,index)
        ok,bgr=c.read()
        if not ok: raise RuntimeError(f'Missing source frame {name}:{index}')
        self.positions[name]=index+1
        return cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)

READER=Reader()
def amount(im,label,amount):
    d=ImageDraw.Draw(im)
    x,y=92,1260
    d.rounded_rectangle((x,y,926,y+182),radius=30,fill=CREAM)
    d.text((x+35,y+24),label,font=font(29,'bold'),fill=GREEN)
    d.text((x+32,y+75),amount,font=font(65,'bold'),fill=INK)
    check(d,854,y+99,33)

def frame(n):
    t=n/FPS
    s=next(s for s in SHOTS if s['start']<=n<s['end'])
    local=(n-s['start'])/FPS
    if s['mode']=='graphic': return graphic(s['source'],local)
    a=READER.frame(s['source'],s['source_in']+n-s['start'])
    progress=ease((n-s['start'])/max(1,s['end']-s['start']-1))
    x=round(s['x0']+(s['x1']-s['x0'])*progress)
    if s['mode']=='close':
        a=cv2.resize(a[:,x:x+405],(W,H),interpolation=cv2.INTER_LANCZOS4)
    else:
        # A wide phone needs its full width. The live detail occupies 73% of
        # the vertical canvas, with softly extended moving scenery at the edges.
        bg=cv2.resize(a,(90,160),interpolation=cv2.INTER_AREA)
        bg=cv2.GaussianBlur(bg,(13,13),0)
        bg=cv2.resize(bg,(W,H),interpolation=cv2.INTER_LINEAR)
        a=cv2.resize(a[:,x:x+560],(W,1389),interpolation=cv2.INTER_LANCZOS4)
        alpha=np.ones((1389,1,1),np.float32)
        alpha[:110,0,0]=np.linspace(0,1,110)
        alpha[-110:,0,0]=np.linspace(1,0,110)
        bg[200:1589]=(a*alpha+bg[200:1589]*(1-alpha)).astype(np.uint8)
        a=bg
    im=Image.fromarray(a)
    d=ImageDraw.Draw(im)
    for begin,end,label in LABELS:
        if begin<=t<end:
            f=font(28,'bold');tw=d.textlength(label,font=f)
            d.rounded_rectangle((86,1335,tw+126,1394),radius=25,fill=CREAM)
            d.text((106,1350),label,font=f,fill=INK)
    if 14<=t<18:
        i=min(2,int((t-14)/1.333333333))
        label,cost=[('GAS & FUEL','$52.10'),('SUPPLIES','$214.60'),('CLIENT MEALS','$18.40')][i]
        amount(im,label,cost)
    if 39.0<=t<40.375:
        amount(im,'COFFEE · THIS MONTH','$46.20')
    return im

def previews():
    times=[.5,2.2,4.3,6.5,8.6,10.4,12.2,14.6,16.0,17.4,18.7,21.0,
           24.3,25.7,27.0,29.7,31.8,33.8,35.9,37.3,39.5,40.7,42.1,44.0,
           46.8,48.1,50.5,53.0,54.9,57.6]
    sheet=Image.new('RGB',(6*270,5*510),(16,28,20));d=ImageDraw.Draw(sheet)
    for i,t in enumerate(times):
        im=frame(round(t*FPS))
        if t in (2.2,24.3,33.8,42.1,50.5,57.6):
            im.save(QA/f'portrait-preview-{t:.1f}.png')
        im=im.resize((270,480),Image.Resampling.LANCZOS)
        x=i%6*270;y=i//6*510
        sheet.paste(im,(x,y));d.text((x+10,y+484),str(t)+'s',font=font(18),fill='white')
    sheet.save(QA/'portrait-contact-sheet-before-captions.jpg',quality=93)

def render():
    picture=OUT/'portrait-picture.mp4'
    cmd=[FF,'-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}',
         '-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','18',
         '-pix_fmt','yuv420p','-movflags','+faststart',str(picture)]
    with open(ROOT/'production/portrait-render.log','w') as log:
        proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log)
        for n in range(60*FPS):
            proc.stdin.write(frame(n).tobytes())
            if n%(FPS*5)==0: print(f'Rendered {n//FPS}/60 seconds',flush=True)
        proc.stdin.close()
        if proc.wait(): raise RuntimeError('Portrait picture render failed')
    master=OUT/'ReceiptNest_I-Have-My-Ways_9x16_CLEAN.mp4'
    subprocess.run([FF,'-y','-v','error','-i',str(picture),'-i',
        str(OUT/'ReceiptNest_I-Have-My-Ways_ANIMATED-CUT.mp4'),'-map','0:v:0',
        '-map','1:a:0','-c','copy','-t','60','-movflags','+faststart',str(master)],check=True)
    print(master,flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--preview',action='store_true')
    args=parser.parse_args()
    (ROOT/'production/portrait-timeline.json').write_text(json.dumps({
        'size':[W,H],'fps':FPS,'duration':60,'shots':SHOTS,
        'policy':'Actual animated source footage, native portrait product graphics, unchanged final audio.'},indent=2))
    if args.preview: previews()
    else: render()
