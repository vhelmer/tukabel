"""Reproducible boundary benchmark: binary SAM, closed-form and ViTMatte."""
import json
import os
from pathlib import Path
import subprocess
import sys
import cv2 as cv
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path('scripts/segmentation').resolve()))
from matting import estimate_alpha, foreground

cv.setNumThreads(1)
root=Path(sys.argv[1])
fixtures=json.loads((root/'fixtures.json').read_text())
metrics=[]
rows=[]
for fixture in fixtures:
    folder=root/fixture['id']
    subprocess.run([sys.executable,'scripts/segmentation/segment.py',str(folder),'sam2','source-edges','standard'],check=True)
    image=cv.imread(str(folder/'source.png'),cv.IMREAD_UNCHANGED)
    binary=cv.imread(str(folder/'result.png'),0)
    cv.imwrite(str(folder/'sam.png'),binary)
    truth=cv.imread(str(folder/'truth.png'),cv.IMREAD_UNCHANGED)
    true_a=truth[:,:,3].astype(np.float64)/255
    inside=(true_a>=0.5).astype(np.uint8)
    kernel=np.ones((9,9),np.uint8)
    edge=(cv.dilate(inside,kernel)!=cv.erode(inside,kernel))
    panels=[]
    for method in ['reference','binary','closed-form','vitmatte-raw','vitmatte']:
        if method=='reference':
            alpha=truth[:,:,3]
            fg=truth
        elif method=='binary':
            alpha=binary
            fg=image
        else:
            alpha,_=estimate_alpha(image,binary,np.zeros_like(binary),method,4)
            fg=foreground(image,alpha)
        cv.imwrite(str(folder/f'{method}-alpha.png'),alpha)
        output=fg.copy();output[:,:,3]=alpha
        cv.imwrite(str(folder/f'{method}-cutout.png'),output)
        a=alpha.astype(np.float64)/255
        error=float(np.mean(np.abs(a[edge]-true_a[edge])))
        grad=float(np.mean([np.mean(np.abs(cv.Sobel(a,cv.CV_64F,dx,dy)[edge]-cv.Sobel(true_a,cv.CV_64F,dx,dy)[edge])) for dx,dy in [(1,0),(0,1)]]))
        colors=[]
        previews=[]
        for bg in [255,0]:
            composite=fg[:,:,:3]*a[:,:,None]+bg*(1-a[:,:,None])
            target=truth[:,:,:3]*true_a[:,:,None]+bg*(1-true_a[:,:,None])
            colors.append(float(np.mean(np.abs(composite[edge]-target[edge]))))
            x,y,w,h=fixture['crop']
            panel=Image.fromarray(cv.cvtColor(np.round(composite).astype(np.uint8)[y:y+h,x:x+w],cv.COLOR_BGR2RGB))
            panel.thumbnail((450,270))
            previews.append(panel)
        item={'image':fixture['id'],'method':method,'boundaryAlphaMAE':round(error,5),'boundaryGradientMAE':round(grad,5),'compositeMAEwhiteBlack':round(float(np.mean(colors)),3),'fractionalPixels':int(np.count_nonzero((alpha>0)&(alpha<255)))}
        if method != 'reference':
            metrics.append(item);print(json.dumps(item),flush=True)
        canvas=Image.new('RGB',(470,600),'#183028');d=ImageDraw.Draw(canvas)
        label={'reference':'KNOWN ORIGINAL / reference alpha','binary':'SAM binary','closed-form':'Closed-form','vitmatte-raw':'ViTMatte only','vitmatte':'ViTMatte + closed-form'}[method]
        d.text((12,12),f"{fixture['id']} / {label}",fill='white')
        for i,preview in enumerate(previews):canvas.paste(preview,(10,45+i*280))
        panels.append(canvas)
    row=Image.new('RGB',(470*len(panels),600));
    for i,p in enumerate(panels):row.paste(p,(i*470,0))
    rows.append(row)
contact=Image.new('RGB',(rows[0].width,len(rows)*600))
for i,row in enumerate(rows):contact.paste(row,(0,i*600))
contact.save(root/'comparison.png')
(root/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
