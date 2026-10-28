#!/usr/bin/env python3
"""Deterministic original-pixel face rig. Pillow only; no image/API generation."""
from PIL import Image, ImageDraw, ImageChops, ImageFilter
from pathlib import Path
import json, math, hashlib, shutil, sys

# Coordinates below refer to the untouched native scene raster (1672x941).
CONFIGS={
 'sand-girl':{
  'eyes':[
   {'polygon':[(790,642),(791,635),(797,633),(804,635),(813,641),(817,649),(815,656),(807,658),(799,654),(792,649)],'skin':[(818,627),(822,616),(824,623)]},
   {'polygon':[(829,632),(830,623),(836,620),(845,620),(853,622),(859,628),(857,637),(852,643),(842,647),(833,642)],'skin':[(826,630),(863,634),(860,620)]}],
  'mouth':{'bounds':(809,660,861,676),'left':(811,663),'right':(855,646),'center':(835,658)},
  'face':(771,591,888,687),
 },
 'climbing-boy':{
  'eyes':[
   {'polygon':[(1377,332),(1383,326),(1392,323),(1402,322),(1409,322),(1410,331),(1405,338),(1396,342),(1385,342),(1379,339)],'skin':[(1415,329),(1419,320),(1414,309)]},
   {'polygon':[(1430,321),(1432,315),(1438,311),(1448,309),(1457,308),(1457,315),(1453,323),(1444,328),(1435,328)],'skin':[(1419,320),(1420,307),(1460,333)]}],
  'mouth':{'bounds':(1381,344,1467,374),'left':(1387,351),'right':(1459,338),'center':(1423,354)},
  'face':(1344,295,1481,375),
 }
}

def rgba_diff(a,b):
    d=ImageChops.difference(a.convert('RGB'),b.convert('RGB'))
    r,g,bl=d.split();return ImageChops.lighter(ImageChops.lighter(r,g),bl)

def sample_rgb(im,x,y):
    x=max(0,min(im.width-1,x));y=max(0,min(im.height-1,y))
    ix=int(x);iy=int(y);tx=x-ix;ty=y-iy
    colors=[]
    for xx,yy,w in [(ix,iy,(1-tx)*(1-ty)),(ix+1,iy,tx*(1-ty)),(ix,iy+1,(1-tx)*ty),(ix+1,iy+1,tx*ty)]:
        colors.append((im.getpixel((min(im.width-1,xx),min(im.height-1,yy))),w))
    return tuple(round(sum(p[c]*w for p,w in colors)) for c in range(3))

def blink(source,eyes,amount):
    if not amount:return source.copy()
    rgb=source.convert('RGB');paint=rgb.copy();total=Image.new('L',source.size)
    for eye in eyes:
        polygon=[tuple(p) for p in eye['polygon']]
        coverage=Image.new('L',source.size);ImageDraw.Draw(coverage).polygon(polygon,fill=255)
        support=coverage.filter(ImageFilter.MaxFilter(3))
        px=coverage.load();left=min(x for x,y in polygon);right=max(x for x,y in polygon)
        topmost=min(y for x,y in polygon);bottommost=max(y for x,y in polygon)
        samples=[rgb.getpixel(tuple(p)) for p in eye['skin']]
        skin=tuple(round(sum(p[c] for p in samples)/len(samples)) for c in range(3))
        # Original skin samples replace only the local eyeball footprint. A
        # one-pixel matte clears its old contour instead of leaving a brown eye.
        for y in range(max(0,topmost-1),min(source.height,bottommost+2)):
          for x in range(max(0,left-1),min(source.width,right+2)):
            if support.getpixel((x,y)):
              shade=(y-topmost)*.11+(x-left)*.025
              paint.putpixel((x,y),tuple(max(0,min(255,round(c+shade))) for c in skin))
        lid=[]
        for x in range(left,right+1):
            ys=[y for y in range(topmost,bottommost+1) if px[x,y]]
            if not ys:continue
            top,bottom=min(ys),max(ys);height=max(1,bottom-top)
            # Upper lid descends over the eye. At full closure the curved seam
            # stays between its original corners rather than outlining an eye.
            closed=top+height*.69
            lid_y=top+(closed-top)*amount
            lid.append((x,lid_y))
            if amount<1:
              exposed_bottom=bottom-(bottom-closed)*amount
              for y in range(math.ceil(lid_y),math.floor(exposed_bottom)+1):
                sy=top+(y-lid_y)/max(.01,exposed_bottom-lid_y)*height
                paint.putpixel((x,y),sample_rgb(rgb,x,sy))
        # Antialiased local eyelid seam is the only newly traced line.
        high=Image.new('L',(source.width*4,source.height*4))
        ImageDraw.Draw(high).line([(round(x*4),round(y*4)) for x,y in lid],fill=255,width=4,joint='curve')
        line=high.resize(source.size,Image.Resampling.LANCZOS)
        paint.paste((52,35,23),(0,0),line)
        total=ImageChops.lighter(total,support)
    # The mask is local; alpha and every pixel outside it remain exact source.
    out=source.copy();out.paste(paint,(0,0),total);out.putalpha(source.getchannel('A'));return out

def talk(source,mouth,scale_y,scale_x):
    if scale_y==1 and scale_x==1:return source.copy()
    out=source.copy();rgb=source.convert('RGB');left,top,right,bottom=mouth['bounds'];a,b=mouth['left'],mouth['right'];cx,cy=mouth['center']
    slope=(b[1]-a[1])/(b[0]-a[0]); line=lambda x:cy+slope*(x-cx)
    for y in range(top,bottom):
      for x in range(left,right):
        ex=math.sin(math.pi*(x-left)/(right-left))**2
        ey=math.sin(math.pi*(y-top)/(bottom-top))**2
        # The envelope fixes all four patch edges and both lip attachments.
        influence=ex*ey
        sx=cx+(x-cx)/(1+(scale_x-1)*influence)
        sy=line(sx)+(y-line(x))/(1+(scale_y-1)*influence)
        p=sample_rgb(rgb,sx,sy);alpha=source.getpixel((x,y))[3]
        out.putpixel((x,y),(*p,alpha))
    return out

def main():
    config=json.loads((Path(__file__).parent/'rig.json').read_text())
    root=Path(__file__).parent;source=Image.open(root/'source.png').convert('RGBA')
    expected=config['sourceSha256'];assert hashlib.sha256((root/'source.png').read_bytes()).hexdigest()==expected
    eyes=config['eyes'];mouth=config['mouth'];frames={
      'blink':[blink(source,eyes,a) for a in [0,.52,1,.32,0]],
      'talk':[talk(source,mouth,sy,sx) for sy,sx in [(1,1),(.68,1.04),(1.55,1),(1.28,.83),(.38,1.03)]]}
    audit={'sourceSha256':expected,'size':source.size,'method':'Original eye/lip RGB warps with locally sampled eyelid skin; alpha is copied exactly','clips':{}}
    eye_points=[p for eye in eyes for p in eye['polygon']]
    allowed={
      'blink':(min(p[0] for p in eye_points)-1,min(p[1] for p in eye_points)-1,max(p[0] for p in eye_points)+2,max(p[1] for p in eye_points)+2),
      'talk':tuple(mouth['bounds'])}

    for kind,poses in frames.items():
      union=Image.new('L',source.size); hashes=[]
      for i,im in enumerate(poses,1):
        assert im.size==source.size
        assert im.getchannel('A').tobytes()==source.getchannel('A').tobytes()
        region=allowed[kind]
        for y in range(source.height):
          for x in range(source.width):
            if not(region[0]<=x<region[2] and region[1]<=y<region[3]):
              assert im.getpixel((x,y))==source.getpixel((x,y)),('outside face region',kind,i,x,y)

        union=ImageChops.lighter(union,rgba_diff(source,im))
        name=f'{kind}-{i:02d}.png'
        if (kind=='blink' and i in [1,5]) or (kind=='talk' and i==1):shutil.copyfile(root/'source.png',root/name)
        else:im.save(root/name)
        hashes.append(hashlib.sha256((root/name).read_bytes()).hexdigest())
      box=union.getbbox();unique=len({im.tobytes() for im in poses})
      assert unique==(4 if kind=='blink' else 5)
      audit['clips'][kind]={'changedBounds':box,'uniqueFrames':unique,'allowedRegion':allowed[kind],'alphaChangedPixels':0,'changedPixelsOutsideFaceRegion':0,'frameSha256':hashes}
    # A fully closed eye contains neither original eye white nor a pupil.
    for eye in eyes:
      eye_mask=Image.new('L',source.size);ImageDraw.Draw(eye_mask).polygon([tuple(p) for p in eye['polygon']],fill=255)
      white=sum(1 for y in range(source.height) for x in range(source.width) if eye_mask.getpixel((x,y)) and min(frames['blink'][2].getpixel((x,y))[:3])>180)
      assert white==0,('eye did not close',white)
    audit['closedEyeWhitePixels']=0
    a,b=[audit['clips'][k]['changedBounds'] for k in ['blink','talk']]
    assert a[3]<=b[1] or b[3]<=a[1] or a[2]<=b[0] or b[2]<=a[0],('regions overlap',a,b)
    (root/'audit.json').write_text(json.dumps(audit,indent=2)+'\n')
    face=tuple(config['face']);fw,fh=face[2]-face[0],face[3]-face[1]
    sheet=Image.new('RGB',(fw*4*5,(fh*4+24)*2),(105,105,110));dr=ImageDraw.Draw(sheet)
    for row,kind in enumerate(['blink','talk']):
      for i,im in enumerate(frames[kind]):
        tile=Image.new('RGBA',im.size,(105,105,110,255));tile.alpha_composite(im)
        sheet.paste(tile.crop(face).convert('RGB').resize((fw*4,fh*4),Image.Resampling.NEAREST),(i*fw*4,row*(fh*4+24)+24))
        dr.text((i*fw*4+8,row*(fh*4+24)+5),f'{kind} {i+1}',fill='white')
    sheet.save(root/'contact-sheet.png')
    print(json.dumps(audit))
if __name__=='__main__':main()
