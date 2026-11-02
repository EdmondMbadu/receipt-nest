"""ReceiptNest 20-second film. Python/Pillow + FFmpeg; all speech and footage at 1x.
Run: PYTHONPATH=/private/tmp/receiptnest-ad-runtime python3 production/render_ad.py
Actual app components are captured with local fictional fixtures. No live customer data.
"""
from pathlib import Path
from functools import lru_cache
import json, math, subprocess, sys, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg
ROOT=Path(__file__).resolve().parents[1]; A=ROOT/'assets'; P=ROOT/'production'; O=ROOT/'exports'
FF=imageio_ffmpeg.get_ffmpeg_exe(); W,H,FPS=1080,1920,24; N=480; SR=48000
CREAM=(248,246,239); INK=(12,49,40); MINT=(168,225,198); GREEN=(7,94,70); WHITE=(255,255,251)
FILM=A/'freelancer-footage-original.mp4'
# Natural-speed source ranges, quantized to 24fps. Graphical intervals are authored.
SHOTS=[dict(id='chaos',start=0,end=2.5,source=40/24),dict(id='snap',start=2.5,end=4.25,source=198/24),dict(id='relief',start=15.75,end=17.75,source=286/24)]
SPEECH=[(0,1.5,.15),(1.5,2.65,2.45),(2.65,5.2,4.20),(5.2,7.4,7.45),(7.4,9.95,12.05),(9.95,13.035102,16.0)]
# Spoken cue intervals after sample-accurate editing; holds support reading.
CAPTIONS=[(.39,2.15,'Receipts everywhere?'),(2.77,4.05,'Snap them.'),(4.41,5.84,'ReceiptNest organizes them'),(5.85,7.16,'automatically.'),(7.73,10.0,'How much did I spend on food this month?'),(12.31,13.48,'Export a month.'),(13.57,15.25,'Or the whole year.'),(16.27,17.73,'Your business receipts.'),(17.79,19.9,'Ready for tax time.')]

def run(args,**kw): return subprocess.run([FF,'-hide_banner','-loglevel','error',*map(str,args)],check=True,**kw)
def ease(v): v=max(0,min(1,v));return 1-(1-v)**3
@lru_cache(None)
def font(size,serif=False,weight=600): return ImageFont.truetype(str(A/(f'Fraunces-{weight}.ttf' if serif else f'Space-Grotesk-{weight}.ttf')),size)
@lru_cache(None)
def text_layer(text,size,color,serif=False,weight=600,spacing=0):
 f=font(size,serif,weight); b=f.getbbox(text); im=Image.new('RGBA',(max(1,int(f.getlength(text))+8),size+28));d=ImageDraw.Draw(im);d.text((3,-b[1]+3),text,font=f,fill=color);return im

def put_text(im,text,x,y,size=64,color=INK,serif=False,weight=600,alpha=1):
 l=text_layer(text,size,color,serif,weight).copy()
 if alpha<1: l.putalpha(l.getchannel('A').point(lambda z:int(z*max(0,alpha))))
 im.alpha_composite(l,(round(x),round(y)));return l.width

def multiline(im,lines,x,y,size=78,color=INK,serif=False,leading=1.13,alpha=1):
 for i,l in enumerate(lines): put_text(im,l,x,y+i*size*leading,size,color,serif,alpha=alpha)

def pill(im,text,x,y,size=27,bg=GREEN,fg=WHITE,padx=18,pady=13):
 f=font(size); tw=f.getlength(text); d=ImageDraw.Draw(im); hh=size+2*pady
 d.rounded_rectangle((x,y,x+tw+2*padx,y+hh),radius=hh/2,fill=bg)
 put_text(im,text,x+padx-3,y+pady-1,size,fg)

def card(im,source,x,y,width,radius=26,opacity=1):
 h=round(source.height*width/source.width); pic=source.resize((width,h),Image.Resampling.LANCZOS).convert('RGBA')
 mask=Image.new('L',pic.size);ImageDraw.Draw(mask).rounded_rectangle((0,0,width-1,h-1),radius=radius,fill=255)
 pic.putalpha(mask)
 if opacity<1:pic.putalpha(pic.getchannel('A').point(lambda z:int(z*opacity)))
 shadow=Image.new('RGBA',(W,H));sd=ImageDraw.Draw(shadow);sd.rounded_rectangle((x,y+12,x+width,y+h+12),radius=radius,fill=(0,0,0,25));shadow=shadow.filter(ImageFilter.GaussianBlur(18));im.alpha_composite(shadow);im.alpha_composite(pic,(round(x),round(y)))
 return h

def ring(im,box,progress=1,color=MINT,width=5):
 ImageDraw.Draw(im).rounded_rectangle(box,radius=18,outline=(*color,round(220*progress)),width=width)

@lru_cache(None)
def base(dark=False):
 rng=np.random.default_rng(32);col=np.array(INK if dark else CREAM,dtype=float);noise=rng.normal(0,.65,(H,W,1));a=np.clip(col[None,None,:]+noise,0,255).astype('uint8');return Image.fromarray(a).convert('RGBA')

receipt=Image.open(A/'ui-receipt-fields.png').convert('RGB').crop((12,262,418,659))
ai=Image.open(A/'ui-ai-final.jpg').convert('RGB')
ai_answer=ai.crop((8,184,420,245))
month=Image.open(A/'ui-export-month-final.jpg').convert('RGB').crop((25,240,875,397))
year=Image.open(A/'ui-export-year-final.jpg').convert('RGB').crop((25,75,875,232))
logo_source=Image.open(ROOT.parents[1]/'src/assets/receipt-nest.png').convert('RGBA')
logo=Image.new('RGBA',logo_source.size,(255,255,255,255))
logo.alpha_composite(logo_source)
readers={}

def source_image(t,sequential=False):
 shot=next(s for s in SHOTS if s['start']<=t<s['end']); frame=round((t-shot['start'])*FPS)
 vf='scale=-2:1920,crop=1080:1920'
 if sequential:
  if shot['id'] not in readers:
   cmd=[FF,'-v','error','-ss',str(shot['source']),'-i',str(FILM),'-vf',vf,'-frames:v',str(round((shot['end']-shot['start'])*FPS)),'-pix_fmt','rgb24','-f','rawvideo','pipe:1']
   readers[shot['id']]=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  p=readers[shot['id']];data=p.stdout.read(W*H*3)
 else:
  data=run(['-ss',str(shot['source']+frame/FPS),'-i',FILM,'-vf',vf,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],capture_output=True).stdout
 if len(data)!=W*H*3:raise RuntimeError('Missing footage frame '+shot['id']+' '+str(frame))
 return Image.frombytes('RGB',(W,H),data).convert('RGBA')

def caption_on_film(im,lines,y=1050,size=80):
 sizes=[font(size).getlength(l) for l in lines]; hh=len(lines)*size*1.12+48;ww=max(sizes)+54
 box=Image.new('RGBA',(W,H));d=ImageDraw.Draw(box);d.rounded_rectangle((88,y-22,88+ww,y+hh-24),radius=20,fill=(9,38,31,228));im.alpha_composite(box)
 multiline(im,lines,110,y,size,WHITE,leading=1.12)

def frame(t,sequential=False):
 if t<4.25 or 15.75<=t<17.75:
  im=source_image(t,sequential)
  if t<2.5:
   if t<.38: pill(im,'FOR FREELANCERS',100,325,27,bg=CREAM,fg=INK)
   else: caption_on_film(im,['Receipts','everywhere?'],1020,91)
   if t>=.38: put_text(im,'For freelancers & solopreneurs',102,1250,28,WHITE)
  elif t<4.25: caption_on_film(im,['Snap them.'],1110,87)
  else: caption_on_film(im,['Your business','receipts.'],1050,76)
  return im.convert('RGB')
 if 4.25<=t<7.25:
  im=base().copy();p=ease((t-4.25)/.25)
  if t<5.85: multiline(im,['ReceiptNest','organizes them'],98,344,78,INK,leading=1.15)
  else:
   put_text(im,'ReceiptNest organizes them',98,345,42,INK)
   put_text(im,'automatically.',98,422,83,GREEN)
  # Real, populated form fields; focus proceeds through the extracted fields.
  card(im,receipt,98,620+round((1-p)*28),780,26)
  if t>=5.7: ring(im,(127,1244,840,1379),ease((t-5.7)/.3),GREEN,5)
  put_text(im,'Actual app · Sample receipt',104,1430,24,(92,111,103),weight=400)
  return im.convert('RGB')
 if 7.25<=t<12:
  im=base(True).copy(); pill(im,'AI INSIGHTS · PRO',98,315,27,bg=MINT,fg=INK)
  multiline(im,['How much did I spend','on food this month?'],98,432,62,WHITE,leading=1.22)
  if t>=9.62:
   p=ease((t-9.62)/.23)
   put_text(im,'$286.40',96,690+round((1-p)*20),152,MINT,serif=True,alpha=p)
   put_text(im,'Food · November',103,879,43,WHITE,weight=500,alpha=p)
   # The actual app's answer, enlarged and held as evidence below the main value.
   card(im,ai_answer,98,1030,790,20,opacity=p)
   put_text(im,'Sample data · 8 saved food receipts',100,1210,27,(182,211,198),weight=400)
  else:
   put_text(im,'Ask a question about your receipts.',100,810,34,MINT,weight=400)
   # Three restrained thinking dots: a genuine waiting state before the answer.
   d=ImageDraw.Draw(im)
   for i in range(3):
    a=.4+.6*(.5+.5*math.sin((t-7.25)*4-i));c=tuple(int(v*a) for v in MINT);d.ellipse((104+i*30,900,114+i*30,910),fill=c)
  return im.convert('RGB')
 if 12<=t<15.75:
  im=base().copy(); is_year=t>=13.55
  multiline(im,['Or the','whole year.'] if is_year else ['Export','a month.'],98,338,102,INK,serif=True,leading=1.08)
  card(im,year if is_year else month,92,690,880,24)
  # File types are the app's actual export choices, prominent for mobile viewing.
  for x,label in [(100,'PDF'),(478,'CSV')]:
   d=ImageDraw.Draw(im);d.rounded_rectangle((x,950,x+322,1120),radius=24,fill=INK if label=='CSV' else (231,236,225))
   put_text(im,label,x+70,1004 if label=='CSV' else 982,67,WHITE if label=='CSV' else INK)
   if label=='PDF': put_text(im,'PRO',x+125,1068,27,GREEN)
  if t>=14.65:
   d=ImageDraw.Draw(im);d.ellipse((102,1190,138,1226),fill=GREEN);d.line((110,1208,118,1216,131,1201),fill=WHITE,width=4)
   put_text(im,'Yearly collection exported',154,1191,31,GREEN)
  else:put_text(im,'Your records, ready to share.',100,1200,32,GREEN,weight=400)
  put_text(im,'Actual app · Sample data',100,1385,24,(92,111,103),weight=400)
  return im.convert('RGB')
 # Resolved brand ending. The source logo is preserved inside a white badge.
 im=base().copy()
 badge=logo.resize((162,113),Image.Resampling.LANCZOS);card(im,badge,100,320,162,18)
 put_text(im,'ReceiptNest',288,353,58,INK,serif=True)
 multiline(im,['Ready for','tax time.'],95,562,112,INK,serif=True,leading=1.08)
 put_text(im,'For freelancers & solopreneurs',104,862,33,GREEN,weight=500)
 d=ImageDraw.Draw(im);d.rounded_rectangle((98,1010,842,1130),radius=60,fill=GREEN)
 put_text(im,'Start free · First 50 receipts',138,1048,42,WHITE)
 put_text(im,'receipt-nest.com',186,1192,48,INK,weight=500)
 return im.convert('RGB')

def write_srt():
 def stamp(t):
  ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
 (O/'ReceiptNest-Ready-for-Tax-Time-20s.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{s}' for i,(a,b,s) in enumerate(CAPTIONS))+'\n')

def audio():
 raw=run(['-i',A/'narration-original.mp3','-ar',SR,'-ac','1','-f','f32le','pipe:1'],capture_output=True).stdout
 src=np.frombuffer(raw,dtype='<f4');mix=np.zeros(SR*20,dtype=np.float64)
 mapping=[]
 for start,end,dest in SPEECH:
  a,b=round(start*SR),min(round(end*SR),len(src));clip=src[a:b].astype(float).copy();fade=min(200,len(clip)//2);clip[:fade]*=np.linspace(0,1,fade);clip[-fade:]*=np.linspace(1,0,fade)
  j=round(dest*SR);mix[j:j+len(clip)]+=clip*.88;mapping.append(dict(source_in=start,source_out=b/SR,sequence_start=dest,sequence_end=dest+len(clip)/SR,speed=1.0))
 rng=np.random.default_rng(19)
 def noise(at,dur,gain):
  n=round(dur*SR);x=rng.normal(size=n);x=np.convolve(x,[1,-.6],mode='same');e=np.sin(np.linspace(0,np.pi,n))**2; j=round(at*SR);mix[j:j+n]+=x*e*gain
 def tone(at,dur,gain,f):
  n=round(dur*SR);t=np.arange(n)/SR;e=np.minimum(t/.009,1)*np.exp(-t*13)*np.minimum((dur-t)/.025,1);x=(np.sin(2*np.pi*f*t)+.3*np.sin(2*np.pi*f*2*t))*e*gain;j=round(at*SR);mix[j:j+n]+=x
 for at in [.13,.52,.82,1.18]:noise(at,.24,.007)
 noise(3.12,.045,.026);noise(3.19,.028,.012)
 tone(5.88,.24,.025,840);tone(9.66,.22,.023,1050);tone(14.83,.35,.022,740)
 noise(16.12,.075,.016) # quiet laptop closure accent
 mix[-2400:]*=np.linspace(1,0,2400)
 with wave.open(str(P/'mix-raw.wav'),'wb') as out:out.setnchannels(1);out.setsampwidth(2);out.setframerate(SR);out.writeframes((np.clip(mix,-.98,.98)*32767).astype('<i2').tobytes())
 (P/'audio-edit-map.json').write_text(json.dumps(mapping,indent=2))
 run(['-y','-i',P/'mix-raw.wav','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-ar',SR,P/'mix-final.wav'])

def stills():
 for t in [.8,2.9,4.8,6.2,8.2,10.6,12.8,14.9,16.8,18.8]:frame(t).save(P/f'preview-{t:.1f}.jpg',quality=90)
 canvas=Image.new('RGB',(1800,1340),(234,233,225));d=ImageDraw.Draw(canvas)
 for i,t in enumerate([.8,2.9,4.8,6.2,8.2,10.6,12.8,14.9,16.8,18.8]):
  im=Image.open(P/f'preview-{t:.1f}.jpg');im.thumbnail((350,622));x=(i%5)*360;y=(i//5)*670;canvas.paste(im,(x,y));d.text((x+8,y+628),f'{t:.1f}s',font=font(22),fill=INK)
 canvas.save(P/'storyboard.jpg',quality=92)

def render():
 audio();write_srt();out=O/'ReceiptNest-Ready-for-Tax-Time-20s.mp4'
 log=open(P/'render.log','w');cmd=[FF,'-y','-hide_banner','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','pipe:0','-i',str(P/'mix-final.wav'),'-map','0:v:0','-map','1:a:0','-vf','scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar',str(SR),'-movflags','+faststart','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',str(out)]
 p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log)
 try:
  for i in range(N):
   p.stdin.write(frame(i/FPS,True).tobytes())
   if i%120==0: print(f'Rendered {i}/{N}',flush=True)
 finally:p.stdin.close()
 if p.wait()!=0:raise RuntimeError('Render failed; see render.log')
 for q in readers.values():q.stdout.close();q.wait()
 print(out,flush=True)

if __name__=='__main__':
 O.mkdir(exist_ok=True)
 if '--stills' in sys.argv:stills()
 else:render()
