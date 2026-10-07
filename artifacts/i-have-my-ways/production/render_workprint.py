"""Render the 60-second visual workprint. This is not the final character animation.

Requires Pillow, numpy, and imageio-ffmpeg. Original generated artwork is preserved.
All camera moves, type, product cards, timing, score editing, and guide foley are
editable here. No generated character-motion clips are substituted silently.
"""
from pathlib import Path
import json, math, subprocess, sys, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, '/private/tmp/receiptnest-media-runtime')
import imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
W, H, FPS, DURATION = 1280, 720, 24, 60
OUT = ROOT / 'exports'
OUT.mkdir(exist_ok=True)
FONTROOT = Path('/System/Library/Fonts/Supplemental')
def font(size, weight='regular'):
    return ImageFont.truetype(str(FONTROOT / {'regular':'Arial.ttf','bold':'Arial Bold.ttf','serif':'Georgia.ttf','italic':'Georgia Italic.ttf'}[weight]), size)
INK=(27,59,44); GREEN=(58,113,70); CORAL=(223,116,83); CREAM=(250,247,239)
scenes=[
 (0,8,'01-kitchen-night-start.png','TAX SEASON. LATE.', 'The dinner they missed'),
 (8,14,'02-store-start.png','NEXT MORNING', 'A small change'),
 (14,15.333333,'02a-gas.png','ONE SMALL HABIT', 'Gas'),
 (15.333333,16.666667,'02b-lumber.png','ONE SMALL HABIT', 'Supplies'),
 (16.666667,18,'02c-client-coffee.png','ONE SMALL HABIT', 'Client coffee'),
 (18,28,'03-living-room-start.png','MONTH END', 'The first ways'),
 (28,38,'04-garage-start.png','SATURDAY', 'The receipt that mattered'),
 (38,46,'05-coffee-start.png','A WEEK LATER', 'The shared joke'),
 (46,56,'06-dinner-start.png','NEXT TAX SEASON', 'Their evening, back'),
]
lines=[
 (0.5,3.4,'NIA','Marcus. What is “miscellaneous — eighty-six dollars”?'),
 (3.7,5.9,'MARCUS','It made sense in March.'),
 (6.2,7.6,'NIA','We’re fixing this.'),
 (9.3,11.8,'NIA','You’re photographing receipts now?'),
 (12,13.5,'MARCUS','Trying something.'),
 (18.5,20.2,'NIA','This month’s damage?'),
 (20.4,24.0,'MARCUS','Two thousand, nine hundred sixty-one dollars. Forty cents.'),
 (24.5,25.3,'NIA','…How?'),
 (25.8,27.4,'MARCUS','I have my ways.'),
 (29.4,31.2,'NIA','Where’s the receipt?'),
 (32.1,33.2,'MARCUS','This one?'),
 (38.3,39.8,'MARCUS','Coffee this month?'),
 (40.1,41.4,'NIA','Forty-six twenty.'),
 (41.8,42.5,'MARCUS','How?'),
 (43.0,44.5,'NIA','I have my ways.'),
 (46.7,47.8,'MARCUS','Receipts?'),
 (48.2,50.1,'NIA','Already with our accountant.'),
 (51.5,53.2,'MARCUS','When did we even do them?'),
 (53.7,55,'NIA','Every day.'),
]
imgs={s[2]:Image.open(ROOT/'assets'/s[2]).convert('RGB') for s in scenes}
logo=Image.open(ROOT.parents[1]/'src/assets/receipt-nest.png').convert('RGBA')
logo.thumbnail((260,180),Image.Resampling.LANCZOS)
def ease(v):
    v=max(0,min(1,v));return v*v*(3-2*v)
def center(d,text,y,size=34,color=INK,weight='regular'):
    f=font(size,weight); x=(W-d.textlength(text,font=f))/2
    d.text((x,y),text,font=f,fill=color)
def wrap(text,f,maxwidth):
    d=ImageDraw.Draw(Image.new('RGB',(1,1))); out=[]; row=''
    for word in text.split():
        candidate=(row+' '+word).strip()
        if d.textlength(candidate,font=f)>maxwidth and row: out.append(row);row=word
        else: row=candidate
    out.append(row);return out
def background(s,t):
    p=(t-s[0])/(s[1]-s[0]); im=imgs[s[2]]
    z=1.015+.04*ease(p)
    nw,nh=int(W*z),int(H*z)
    scaled=im.resize((nw,nh),Image.Resampling.BICUBIC)
    x=int((nw-W)*(.50+.12*math.sin(p*math.pi)))
    y=int((nh-H)*.44)
    return scaled.crop((x,y,x+W,y+H)).convert('RGBA')
def pill(im,text,x,y,color=INK):
    o=Image.new('RGBA',(W,H)); d=ImageDraw.Draw(o); f=font(17,'bold'); tw=d.textlength(text,font=f)
    d.rounded_rectangle((x,y,x+tw+28,y+34),radius=17,fill=(250,247,239,234))
    d.text((x+14,y+8),text,font=f,fill=color)
    return Image.alpha_composite(im,o)
def caption(im,who,text):
    o=Image.new('RGBA',(W,H));d=ImageDraw.Draw(o)
    f=font(27,'bold'); rows=wrap(text,f,W-180)
    boxH=58+len(rows)*33; yy=H-30-boxH
    d.rounded_rectangle((62,yy,W-62,H-28),radius=13,fill=(14,27,22,225))
    d.text((85,yy+12),who,font=font(14,'bold'),fill=CORAL if who=='NIA' else (165,209,137))
    for i,row in enumerate(rows):
        tw=d.textlength(row,font=f);d.text(((W-tw)/2,yy+34+i*33),row,font=f,fill=(255,255,250))
    return Image.alpha_composite(im,o)
def card_base(label):
    im=Image.new('RGBA',(W,H),CREAM);d=ImageDraw.Draw(im)
    d.ellipse((-240,-470,650,420),fill=(229,237,220))
    d.ellipse((940,430,1450,940),fill=(239,222,204))
    d.text((70,54),'ReceiptNest',font=font(26,'bold'),fill=GREEN)
    d.text((70,98),label,font=font(17,'bold'),fill=(109,122,105))
    return im,d
def monthly(t):
    im,d=card_base('THIS MONTH')
    d.text((74,174),'$2,961.40',font=font(86,'bold'),fill=INK)
    d.text((78,278),'A clear view of the little things.',font=font(22),fill=(96,110,99))
    labels=[('Supplies','$1,240',.9),('Gas & Fuel','$612',.444),('Client meals','$188',.137),('Other','$921.40',.669)]
    for i,(label,value,amount) in enumerate(labels):
        y=154+i*88; x=700
        d.text((x,y),label,font=font(20,'bold'),fill=INK)
        d.text((1105-d.textlength(value,font=font(20)),y),value,font=font(20),fill=INK)
        d.rounded_rectangle((x,y+32,1110,y+46),radius=7,fill=(220,227,213))
        n=amount*ease((t-22.0)*1.8-i*.1)
        if n>.005:d.rounded_rectangle((x,y+32,x+410*n,y+46),radius=7,fill=GREEN)
    d.text((78,493),'CAPTURE  •  ORGANIZE  •  FIND',font=font(16,'bold'),fill=GREEN)
    return im
def drill(t):
    im,d=card_base('THE ONE YOU NEED. RIGHT WHERE YOU LEFT IT.')
    d.rounded_rectangle((100,159,558,596),radius=24,fill='white',outline=(220,223,211),width=2)
    d.text((140,195),'TOOL DEPOT',font=font(27,'bold'),fill=INK)
    d.line((140,245,515,245),fill=(210,216,204),width=2)
    d.text((140,286),'18V Drill Kit',font=font(24),fill=INK)
    d.text((140,343),'$129.00',font=font(56,'bold'),fill=INK)
    for i in range(8):d.rectangle((140+i*40,458,144+i*40+(i%3)*3,511),fill=INK)
    d.text((657,228),'Found it.',font=font(64,'serif'),fill=INK)
    d.text((660,322),'The original receipt.',font=font(26),fill=INK)
    d.text((660,366),'Still clear. Still there.',font=font(24),fill=(100,118,100))
    return im
def email(t):
    im,d=card_base('THE YEAR, WRAPPED UP')
    d.rounded_rectangle((177,180,1103,554),radius=28,fill='white',outline=(215,224,208),width=2)
    d.ellipse((226,219,277,270),fill=GREEN)
    d.line((240,243,250,253,266,232),fill='white',width=4)
    d.text((301,224),'Email sent',font=font(30,'bold'),fill=INK)
    d.text((228,311),'To: our accountant',font=font(22),fill=(106,117,107))
    d.rounded_rectangle((226,367,1054,473),radius=15,fill=CREAM)
    d.text((253,392),'Business receipts.pdf',font=font(25,'bold'),fill=INK)
    d.text((253,434),'Jan – Dec  •  214 receipts',font=font(18),fill=(106,117,107))
    d.text((227,506),'PDF export with ReceiptNest Pro',font=font(16),fill=(106,117,107))
    return im
def endcard(t):
    im=Image.new('RGBA',(W,H),'white');d=ImageDraw.Draw(im)
    im.alpha_composite(logo,((W-logo.width)//2,64))
    center(d,'ReceiptNest',268,51,GREEN,'bold')
    center(d,'Just snap.',349,67,INK,'serif')
    center(d,'Less paperwork. More life.',441,25,(93,111,95))
    center(d,'Start free  ·  iOS & Android',506,24,INK,'bold')
    center(d,'receipt-nest.com',551,29,GREEN,'bold')
    center(d,'CSV export included · PDF with Pro',643,16,(101,116,103))
    return im
def frame(t):
    if t>=56:im=endcard(t)
    elif 22<=t<24.2:im=monthly(t)
    elif 33.25<=t<35.2:im=drill(t)
    elif 50.05<=t<51.55:im=email(t)
    else:
        s=next(s for s in scenes if s[0]<=t<s[1]);im=background(s,t)
        if t-s[0]<2.2:im=pill(im,s[3],40,44)
        if 14<=t<18:
            i=min(2,int((t-14)/1.3333334)); label,amount=[('Gas & Fuel','$52.10'),('Supplies','$214.60'),('Client meals','$18.40')][i]
            o=Image.new('RGBA',(W,H));d=ImageDraw.Draw(o)
            d.rounded_rectangle((768,469,1228,589),radius=21,fill=(250,247,239,246))
            d.text((796,490),label,font=font(19,'bold'),fill=GREEN)
            d.text((796,523),amount,font=font(34,'bold'),fill=INK)
            d.ellipse((1150,506,1200,556),fill=GREEN)
            d.line((1161,531,1173,541,1190,519),fill='white',width=4)
            im=Image.alpha_composite(im,o)
    if t<56:
        for start,end,who,text in lines:
            if start<=t<end:im=caption(im,who,text);break
    d=ImageDraw.Draw(im)
    label='VISUAL WORKPRINT'
    d.rounded_rectangle((W-202,16,W-16,43),radius=6,fill=(17,37,28,190))
    d.text((W-190,23),label,font=font(13,'bold'),fill=(246,244,230))
    # Gentle fades on the opening and the final twelve frames only.
    fade=min(1,t/.35,(DURATION-t)/.45)
    if fade<1:im=Image.blend(Image.new('RGBA',(W,H),(17,31,23,255)),im,max(0,fade))
    return im.convert('RGB')

timeline={'status':'visual workprint; still artwork with camera motion, score, guide effects and dialogue captions; not final character animation or final voices','duration':60,'fps':FPS,'scenes':[{'start':s[0],'end':s[1],'asset':s[2],'label':s[3],'beat':s[4]} for s in scenes], 'dialogue':[{'start':s,'end':e,'speaker':w,'text':x} for s,e,w,x in lines]}
(ROOT/'production'/'timeline.json').write_text(json.dumps(timeline,indent=2))
def tc(s):
    ms=round(s*1000);return f'{ms//3600000:02}:{(ms//60000)%60:02}:{(ms//1000)%60:02},{ms%1000:03}'
(OUT/'dialogue-guide.srt').write_text('\n\n'.join(f'{i+1}\n{tc(s)} --> {tc(e)}\n{w}: {x}' for i,(s,e,w,x) in enumerate(lines))+'\n')
for name,t in [('opening',2),('monthly',23),('receipt',34),('coffee',43.5),('finale',54),('endcard',58)]:
    frame(t).save(OUT/f'preview-{name}.jpg',quality=94)

video=OUT/'visual-workprint-picture.mp4'
cmd=[FF,'-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(video)]
with open(ROOT/'production/render.log','w') as log:
    process=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log)
    for n in range(FPS*DURATION):
        process.stdin.write(frame(n/FPS).tobytes())
    process.stdin.close()
    if process.wait():raise RuntimeError('Video render failed; see render.log')

# Subtle editorial guide effects. These do not pretend to be recorded scene foley.
SR=48000;fx=np.zeros(SR*DURATION,dtype=np.float32);rng=np.random.default_rng(7)
def add(at,sound,gain=1):
    k=round(at*SR); stop=min(len(fx),k+len(sound));fx[k:stop]+=sound[:stop-k]*gain
for t in [9.0,14.25,15.58,16.92]:
    n=int(.055*SR);x=rng.normal(0,1,n);x=np.diff(np.r_[0,x]);x*=np.exp(-np.arange(n)/(SR*.009));add(t,x,.05)
    n=int(.13*SR);tt=np.arange(n)/SR;add(t+.09,np.sin(2*np.pi*1450*tt)*np.exp(-tt*36),.012)
for i,hz in enumerate([440,554.365,659.255]):
    tt=np.arange(int(.8*SR))/SR;add(56.15+i*.14,(np.sin(2*np.pi*hz*tt)+.22*np.sin(2*np.pi*hz*2*tt))*np.exp(-tt*5),.016)
with wave.open(str(ROOT/'audio/guide-effects.wav'),'wb') as f:
    f.setnchannels(1);f.setsampwidth(2);f.setframerate(SR);f.writeframes((np.clip(fx,-1,1)*32767).astype('<i2').tobytes())
final=OUT/'ReceiptNest_I-Have-My-Ways_VISUAL-WORKPRINT.mp4'
filters='[1:a]afade=t=in:d=0.7,afade=t=out:st=58.8:d=1.2,volume=0.68[m];[2:a]volume=0.7[f];[m][f]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-18:TP=-1.5:LRA=9[a]'
subprocess.run([FF,'-y','-i',str(video),'-i',str(ROOT/'audio/firefly-score-track-1.wav'),'-i',str(ROOT/'audio/guide-effects.wav'),'-filter_complex',filters,'-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','256k','-ar','48000','-t','60','-movflags','+faststart',str(final)],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,check=True)
print(final)
