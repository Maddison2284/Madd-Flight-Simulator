"""Original CC0 generic business jet. Local +X forward, +Y left, +Z up."""
import math,struct,json,pathlib
verts=[]; inds=[]; colors=[]
paint=(.9,.94,.98,1)
def mesh(points,faces):
 base=len(verts);verts.extend(points);colors.extend([paint]*len(points))
 for face in faces:
  for i in range(1,len(face)-1): inds.extend([base+face[0],base+face[i],base+face[i+1]])
def tube(rings,n=20):
 p=[]
 for x,ry,rz,z in rings:
  p += [(x,math.cos(i*2*math.pi/n)*ry,z+math.sin(i*2*math.pi/n)*rz) for i in range(n)]
 faces=[]
 for j in range(len(rings)-1):
  for i in range(n):faces.append([j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i])
 faces += [list(range(n-1,-1,-1)),list(range((len(rings)-1)*n,len(rings)*n))]
 mesh(p,faces)
def wing(x,span,z,chord):
 for s in [-1,1]:
  mesh([(x,0,z),(x-chord,0,z),(x-chord-1,s*span,z+.2),(x-1.5,s*span,z+.2),(x,0,z+.12),(x-chord,0,z+.12),(x-chord-1,s*span,z+.32),(x-1.5,s*span,z+.32)],[[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]])
tube([(-7,.15,.2,0),(-5,.7,.7,0),(-2,.85,.9,0),(4,.85,.9,0),(6,.65,.7,0),(8,.05,.1,-.1)])
wing(1,8,-.35,3);wing(-4.8,3,.8,1.6)
paint=(.025,.1,.18,1)
mesh([(-6,0,.5),(-7,0,3.5),(-5.6,0,3.5),(-3.5,0,.5),(-6,.15,.5),(-7,.15,3.5),(-5.6,.15,3.5),(-3.5,.15,.5)],[[0,1,2,3],[4,7,6,5],[1,5,6,2],[0,4,5,1],[2,6,7,3],[0,3,7,4]])
paint=(.72,.78,.83,1)
# Twin rear nacelles
for side in [-1,1]:
 start=len(verts);tube([(-5,.4,.4,.5),(-2,.4,.4,.5)])
 for i in range(start,len(verts)):
  x,y,z=verts[i];verts[i]=(x,y+side*1.2,z)
# Dark cabin windows, cockpit glazing, livery and engine openings.
paint=(.018,.06,.095,1)
for side in [-1,1]:
 for x in [-2.8,-1.5,-.2,1.1,2.4]:
  points=[(x+math.cos(i*math.pi/8)*.22,side*.86,.28+math.sin(i*math.pi/8)*.19) for i in range(16)]
  mesh(points,[list(range(16))])
 mesh([(4.3,side*.58,.72),(5.65,side*.4,.53),(5.65,0,.82),(4.3,0,.94)],[[0,1,2,3]])
 # Slim teal fuselage stripe.
 paint=(.09,.6,.58,1)
 mesh([(-4,side*.81,-.14),(4,side*.86,-.14),(4,side*.86,-.23),(-4,side*.81,-.23)],[[0,1,2,3]])
 paint=(.018,.06,.095,1)
 # Engine fan faces, positioned at the nacelle intakes.
 mesh([(-1.99,side*1.2+math.cos(i*math.pi/12)*.31,.5+math.sin(i*math.pi/12)*.31) for i in range(24)],[list(range(24))])
# Navigation lights on both wing tips.
for side,color in [(-1,(.08,1,.4,1)),(1,(1,.08,.05,1))]:
 paint=color
 mesh([(-1.5,side*8,.3),(-2,side*8,.3),(-1.8,side*8.05,.5)],[[0,1,2]])
# Flat face normals make the low-poly surfaces light correctly.
original = verts
expanded = []; normals = []; expanded_colors=[]
for i in range(0, len(inds), 3):
 a,b,c = [original[j] for j in inds[i:i+3]]
 u=[b[j]-a[j] for j in range(3)]; v=[c[j]-a[j] for j in range(3)]
 n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
 length=math.sqrt(sum(x*x for x in n)) or 1
 expanded_colors.extend([colors[j] for j in inds[i:i+3]])
 expanded.extend([a,b,c]); normals.extend([[x/length for x in n]]*3)
verts=expanded; inds=list(range(len(verts)))
pos=b''.join(struct.pack('<fff',*p) for p in verts);idx=b''.join(struct.pack('<I',i) for i in inds);normal_bytes=b''.join(struct.pack('<fff',*n) for n in normals);color_bytes=b''.join(struct.pack('<ffff',*c) for c in expanded_colors);buf=pos+idx+normal_bytes+color_bytes
# Convert original X-forward/Z-up frame into standard glTF Z-forward/Y-up.
# Cesium applies Y_UP_TO_Z_UP * Z_UP_TO_X_UP on load.
gltf={'asset':{'version':'2.0','generator':'MADD original CC0 jet'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'rotation':[-.5,-.5,-.5,.5]}],'meshes':[{'primitives':[{'attributes':{'POSITION':0,'NORMAL':2,'COLOR_0':3},'indices':1,'material':0}]}],'materials':[{'doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':.25,'roughnessFactor':.4}}],'buffers':[{'byteLength':len(buf)}],'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(pos),'target':34962},{'buffer':0,'byteOffset':len(pos),'byteLength':len(idx),'target':34963},{'buffer':0,'byteOffset':len(pos)+len(idx),'byteLength':len(normal_bytes),'target':34962},{'buffer':0,'byteOffset':len(pos)+len(idx)+len(normal_bytes),'byteLength':len(color_bytes),'target':34962}],'accessors':[{'bufferView':0,'componentType':5126,'count':len(verts),'type':'VEC3','min':[min(p[j] for p in verts) for j in range(3)],'max':[max(p[j] for p in verts) for j in range(3)]},{'bufferView':1,'componentType':5125,'count':len(inds),'type':'SCALAR'},{'bufferView':2,'componentType':5126,'count':len(verts),'type':'VEC3'},{'bufferView':3,'componentType':5126,'count':len(verts),'type':'VEC4'}]}
j=json.dumps(gltf,separators=(',',':')).encode();j+=b' '*((-len(j))%4);buf+=b'\0'*((-len(buf))%4)
pathlib.Path('public/models/business-jet.glb').write_bytes(struct.pack('<III',0x46546c67,2,12+8+len(j)+8+len(buf))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(buf),0x004e4942)+buf)
