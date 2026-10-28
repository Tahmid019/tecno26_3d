# Local campus player

Double-click `../START_CAMPUS.cmd`, then open http://127.0.0.1:5173/. Keep its
terminal open while playing. Node.js must be installed (it is installed on this
laptop). To reach it from a phone, point your tunnel at the same port.

For editing, run `npm run dev`. After source changes run `npm run build`, which
updates the standalone version used by `npm start` and the launcher.

## Controls

Phone (the main target): a round thumb stick bottom left, round buttons bottom
right. Drag the stick to walk, as fast as it is pushed, and right against the
rim to run; a thumb resting near the rim does not flicker in and out of a run,
and small sideways drift is ignored. The chip just above the stick is the
sprint lock, and it works both ways round: tap it, or drag your thumb on up
past the rim onto the chip, hold it there a moment and let go. An ordinary
push forward, however hard, never locks it. Locked, it runs forward on its own
and keeps pulsing so you cannot miss it; tap it again or pull the stick back
to stop, the same auto-run as BGMI. **Jump** hops. **Ride** appears within three
metres of any free bicycle: there are racks beside the sports complex, the
basketball courts, the cricket ground, the library, the lecture gallery and the
administration building. The student walks round to the bicycle's left, takes
the bars, swings a leg over the back wheel and sits; riding cruises at 8 m/s
and sprints at 12, with the speed in km/h beside the place name. Pedalling
builds speed over a couple of seconds (a partial push of the stick pedals
gently), letting go coasts, pulling back brakes and, once stopped, walks the
bicycle backwards with the pedals turning back; **Jump** becomes a hop that
clears a kerb. **Get off** brakes to a stop, puts a foot down and steps off
the same way, leaving the bicycle on its stand, and the bell button rings. The
bottom bar has the clock and the time of day (**Day & night** runs the clock;
Morning, Noon, Evening and Night hold it), the graphics quality and the
speaker button for the sound. Drag anywhere else to look, pinch to change the
camera distance.

Desktop: WASD to walk, Shift to run, Space to jump (or hop on a bicycle), F
to get on and off a bicycle (or pick one up off the ground), B to ring the
bell, M for sound, R to return to the sports complex, Escape to pause.

The place list is the dropdown in the top bar; **Concert** puts you on the
football entrance sightline facing the stage, and **Campus overview** lifts to a
plan view. **Library** and **Lecture gallery** stay greyed out until the
outlying buildings finish streaming.

**Administration** now appears in the same place list and streams with the
other outlying buildings. It takes you to the red-paved entrance approach;
use the central ramp to reach the raised courtyard. Its road connects to the
gallery road, and the map and overview include the full extension.

The administration building and its grounds are drawn 1.25 times the supplied
model (`scale` in `lib/admin-placement.json`), so the podium stands at 3.75 m.
Cars, scooters, bins, potted plants and trees are not enlarged: each only moves
with the ground it stands on, so they stay life-size beside the bigger building.
The two cars that were parked in the courtyard between the blocks are gone. The
trees that stood on the side road and in the west yard's parking now stand on
the lawn beside them, and the Norfolk pines are drawn as pines. Wall paint and
the grey cladding were recoloured for the browser's tone mapping to match the
drone photographs, and the lawn and asphalt take the campus's own values, so the
plot has no visible edge. The front street carries on past both ends of the
plot, and the ground runs on far beyond it on every side.

Its origin is approximately 410 metres east of the existing gallery, with the
main entrance facing northeast (38.4 degrees east of north). Placement uses the
original administration drone GPS and the source model's corresponding camera
positions; allow about 15–25 metres of uncertainty. Existing library and gallery
positions are unchanged. The original .blend in `astra 1/admin_building` is
untouched.

`../prepare_admin.py` prepares the source model and nearby landscape for the
browser, already enlarged to the placement's scale; `../build_admin_link.py`
creates the road, terrain extension and new
`../output/NIT_Silchar_Campus_With_Administration.blend`. The shared placement
is in `lib/admin-placement.json`; after changing its scale, re-run both scripts
(the tests fail until you do). Source exports live in `../output/admin_source*`
and are copied to `public/assets/admin*` for the player.

The lecture gallery's shell is a hand-built reconstruction, modelled from the
same six drone photographs plus four ground photographs, in
`../gallery_reference.blend`. It replaced a Meshy photogrammetry sculpt whose
edges frayed and whose entrance had melted into an unresolvable recess. Being
ordinary modelled geometry split by material, it is editable, needs no texture
beyond the two entrance column murals, and is smaller: 604 KB of display mesh
and 251 KB of collision against the sculpt's 1.62 MB and 482 KB. It draws 109k
triangles in 26 calls, and a hull cut from its own wall, plinth, column, stone
and glazing surfaces carries the collision. The front doors are sealed — there
is no interior behind them — so the entrance steps take you up onto the porch
and no further.

The lecture gallery stands north east of the library — four octagonal lecture
theatres around a central hall, a fan roofed auditorium on the north west side
and a three storey wing to the south east, with its entrance facing south. Its
six drone photographs put its centre 122 m north and 126 m east of the
library's. The library road carries on past the library to its forecourt — one
road, built once in `build_library.py`, so the two stretches cannot drift apart
in width, surface or kerb.

## Loading

The download is staged. Everything needed to stand up and walk — campus,
walkable collision, the student and the tree list — arrives first with a real
percentage on the start panel, and the outlying buildings (library, lecture
gallery and administration) stream in afterwards while you are already
exploring; a small chip shows their progress and their destinations stay greyed
out until they land. Over the wire the whole campus is
about 4.3 MB: `campus_upd.glb` and `library.glb` are Draco-compressed, the character
and aerial textures are JPEG rather than PNG, and `scripts/serve.mjs` gzips
what is left. Uncompressed, the same assets were about 41 MB.

The two collision meshes are deliberately **not** Draco-compressed. Their floor
heights are asserted to the centimetre, and the test suite reads them without a
browser, where a Draco decoder needs a worker that Node does not provide.

## Notes

`npm test` checks player collisions, field spawn heights, the jump arc on the
real campus mesh, character animations, concert alignment, road continuity, the
statue budget, and that no tree is planted in a carriageway. The riding tests
check the pedals stay on the crank circle, the leg solver reaches its targets,
a rider's feet stay on the pedals and hands on the grips all the way round the
stroke, and that everyone on the roads keeps left. `tests/campus-life.test.ts`
checks getting on (the right foot clears the back wheel and the hips end on
the saddle), that each baked crowd pose moves only what it should, the
audience's aisle and colliders, which pattern each building surface gets, that
lamps line the verges and light only after dark, that posts and parked
bicycles push people round them, the sun's path, and that the extra solid
world stops a runner, carries someone dropped on it and reports a hard hit.
For the
administration it also checks the export's scale, the ramp up to the 3.75 m
podium, a courtyard clear of cars, and the front street running on past the plot.

The road corridor is kept clear of trunks twice over: the aerial planting list
is filtered against every road centre line as it loads, and the gallery's own
perimeter planting is seeded outside the carriageway in `../build_gallery.py`.
The final leg into the forecourt carries no kerb or footway, which would
otherwise draw a white band straight across the paving.

Grass is planted by sampling the lawn surfaces downwards and rejecting anything
the walkable collision tree already covers, so it never grows through roads,
courts, stages or steps. Blades bend away from the student and spring back
behind him. Tiles beyond half the planting radius are sown thinner, so the lawn
reaches the horizon while staying thick underfoot. Radius and density both
follow the graphics quality setting. A lawn more than 0.7 m up is taken for a
roof garden and left bare, except the administration's, which climbs its slopes
to the raised podium.

The student ships with Walk, Run and Idle clips. Each plays at the pace
actually being moved (the walk's planted foot travels at 1.39 m/s, the run's at
4.8), so the shoes stay put on the ground instead of skating, and changing pace
keeps step. The clips hold the arms out from the body, a leftover of the rig's
A-pose, so `lib/posture.ts` brings them in toward the sides. Jumping has no
clip, so it is posed on top of whichever one is playing, blended by weight:
from a standstill the knees bend for a tenth of a second before the push-off,
in the air the legs tuck most at the top and reach for the ground on the way
down, and the landing bends the knees (hips down, feet kept where they land,
the body leaning over them, arms out a little) by how hard the fall was, with
a thud to match. A jump pressed a moment before landing, or a moment after
running off an edge, still happens.

The mixer only writes a bone when its animated value changes. Anything posed
on top therefore starts again from a saved copy of the clean animated pose
every frame; laid straight onto the bones, last frame's lean survived on every
bone the idle clip holds still and stacked up until the rider folded over the
bars.

Riding is solved, not animated (`lib/rider.ts`). The bicycle is a roadster
sized for the student: 26 inch wheels, a saddle at 0.83 m and swept-back bars.
Every frame the hips sit on the saddle with a city rider's lean, two-bone
inverse kinematics puts the ball of each foot on its pedal and each hand on its
grip, and the head looks a few metres up the road and into turns. The cranks
turn with the rear wheel at 6 m a revolution, about 80 rpm cruising. Coasting
levels them; sprinting lifts the rider out of the saddle, low over the bars,
with the bicycle rocking under the pedal stroke. Stopping puts the left foot
down and leans the bicycle onto it, with the right pedal raised to push off.
Riding is steered, not strafed: the bars turn, the bicycle leans into the curve
and the camera eases round behind unless you are dragging it.

Collisions and knocks. What can be seen is solid: the walkable meshes leave
out hedges, nets, parked cars and scooters, lamp posts, bins, columns, the
library's lower glazing and a few sports complex walls, so those drawn
surfaces form a second collision world (`extra` in `PlayerPhysics`) that you
bump into and can stand on, while the ground probes for people, grass and
lamps keep to the walkable one. An audit casting rays from 23,786 standing
points across the map found 501 places where you could walk through
something visible; 19 remain, all slopes and rooftops. Every road, down the
middle and along both verges, and the way into every landmark were walked by
a bot with no stuck spots, and the solid world blocks no entrance that was
open before. Walk into someone and they stagger a step, stop and look round;
hit them on a bicycle above about 16 km/h and they fall flat and get up a few
seconds later, and people nearby turn to look. Ride into a wall or a post
above about 22 km/h, into someone at a sprint, or land a drop of more than
about 6 m, and you go over the bars in a tumble, land winded and get up; the
bicycle stays on its side until you pick it up with F. Ridden or run into, a
parked bicycle falls over. A drop of more than about 2.5 m on foot lands
heavily, the view widens with speed, and hard landings and crashes jolt the
camera.

Riding smoothness. A wheel's spokes are never drawn turning more than a
fraction of a spoke a frame: at riding pace a phone drew them three spokes on
per frame, so they seemed to stutter or spin backwards. Kerbs and steps lift
the body over a few frames rather than in one jump. Below High on a computer,
the sun's shadow map holds only what stands still and is redrawn now and then;
people and bicycles have contact shadows that move with them every frame (a
shadow from the map lagged metres behind a bicycle and jumped to catch up).
On High on a computer the map is redrawn every frame and everyone casts real
shadows. Small per-tile shading on pavers, tiles and cladding fades out before
it can sparkle in the distance as the view moves.

Getting on and off is the same solver run along a path (`mount` in
`RideState`): from standing on the bicycle's left the hands go to the grips,
the right foot rises in an arc high over the back wheel and down onto the
raised pedal while the hips come across onto the saddle, and the left foot
stays on the ground; the stand flips up with a clack. Getting off runs it
backwards once the bicycle has stopped.

All the bicycles on campus, parked or ridden, are one fleet drawn as nine
instanced parts (`lib/bicycle.ts`): frames in eight paints, some step-through,
some with baskets, all with mudguards, a carrier, a chain guard and a kickstand
that swings down when one is parked.

Other students fill the campus (`lib/npcs.ts`). Walkers stroll the road verges
and sometimes stop; groups of two to four chat outside the buildings, glancing
at whoever is talking; cyclists ride the same bicycles with the same rig as the
player, keeping to the left of the road as traffic does in India, slowing and
swinging out round anyone in their lane and ringing the bell. Everyone is a
lighter copy of the student (`public/assets/npc.glb`, 11.6 thousand triangles
from `../prepare_npc.py`) recoloured in the shader: shirt, trousers and skin
tone, with a little spread of height. They turn their heads to you as you come
close, and stop rather than walk through you; you cannot walk through them
either. Only people near the player exist at all: anyone who falls far behind
is moved to a road out of sight ahead, so the cost stays the same anywhere on
campus. Performance keeps about a dozen people, Balanced about two dozen and
High about thirty. Walkers step round lamp posts, parked bicycles and each
other and fall in behind anyone slower; cyclists swing out round anything in
their lane. Lamp posts and parked bicycles are solid to you too, on foot or on
a bicycle (the front wheel is felt for as well, and a knock slows you).

The sky (`lib/sky.ts`) is one shader: a blue gradient warming toward the sun,
the sun's disc and glow, and a deck of cumulus 600 m up, painted from a tiling
noise texture the GPU renders once at start-up. Each pixel finds where its ray
meets the deck, so the clouds hang over the campus and pass overhead as you
move rather than riding along with the camera. They are lit from the sun's side,
shaded blue-grey beneath and lost into the same haze as the fog, so the horizon
meets the ground without a seam. High adds finer detail, heaped cumulus and a
second, high layer of cirrus.

Day and night (`lib/daylight.ts`): a campus hour passes in a real minute by
day and the night runs three times faster. The sun rises in the east, stands
64 degrees up at noon a little to the south (Silchar is at 24.8° N) and sets in
the west; every colour is keyed to its height, so the golden hour, the rose and
purple of dusk and the blue of moonlight follow from where the sun is. The same
sky, sun glow included, is baked into the light every surface is lit by
whenever the hour has moved on, so glass and metal reflect the time of day. At
night stars come out and a moon rises, both hidden by cloud, and the moon
casts the shadows. The shadow map follows the sun and the moon, is aimed mostly
ahead of the camera, and is larger and finer on High.

Street lights (`lib/streetlights.ts`) stand about every 32 m along every road,
alternating sides, on the verge and never on a carriageway, a court, in a wall
or a tree; the campus's own lamps and the administration site's are lit too.
At dusk their heads glow, and the twelve nearest the camera light the road,
the verges, walls, people and bicycles under them through the surface shader:
lighting without the cost of real lights. About half the windows light up
inside, warm or tube-light white, and the TECNOESIS stage throws a warm wash
over the crowd.

The buildings were modelled in plain colours with no textures, which is what
made them look like toys. `lib/surfaces.ts` gives every surface a pattern from
where it is in the world, by what it is made of: rain and algae streaks down
plaster and damp along the foot of walls, mottled and stained concrete, the
joints and slightly uneven sheets of the administration's ACP cladding,
interlocking pavers with charcoal ones scattered through the red, tiles and
terrazzo, granite speckle, corrugated and tiled roofs, glass panes each a
fraction out of plane so they reflect the sky differently, clumps of leaves on
the hedges and drier patches in the lawns. It is all one 256-pixel noise
texture made at start-up, so it costs no download.

Trees: the leafy trees grow at Balanced as well as High on a computer (about a
millisecond more than the simple ones); phones keep them for High, and their
simpler crowns get the hedges' leaf-clump texture. On phones and at
Performance the surface patterns drop their per-pixel relief and light each
pixel from the six nearest lamps rather than twelve, and the shadow map is
re-aimed less eagerly as the view swings round. Every tree
casts a shadow, from a rough unseen stand-in crown, which costs the shadow map
a fraction of what the leaves would.

The TECNOESIS audience and band (`lib/audience.ts`) are the student's own
model, lightened to under four thousand triangles (`public/assets/crowd.glb`,
from `../prepare_crowd.py`), posed eleven ways at load (arms up in a V,
clapping over the head and in front of the chest, filming on a phone, punching
the air, bouncing at the knees, nodding, playing guitar and keys, sitting at
the drums) and baked into one mesh's morph targets. All 125 are one instanced
draw, each person blending between their poses in time with 126 beats a
minute, in their own clothes; the band wears black and the guitarists carry
guitars. They stand packed near the barrier and thinning towards the back, in
little knots, with the aisle kept clear, and they are solid. Beyond 320 m none
of them is drawn.

Sound (`lib/audio.ts`) is synthesised in the browser, so nothing is downloaded:
wind in the trees, birdsong (now and then an Asian koel's rising call), the
murmur of groups as you pass, footsteps timed to each foot coming down (soft on
grass, a tap on paving), a thud on landing, tyre hum, a freewheel ticking when
coasting, the stand's clack and the bell. After dark the birds fall quiet and
crickets take over. It starts with the first tap, as browsers require.

Only the camera's boom *length* reacts to obstacles, and the position itself
always eases towards it. Snapping the camera on frames where its collision ray
found something and easing on frames where it missed shook the whole picture at
riding pace, because at 14.5 m/s that ray flickers on and off every kerb and
verge it passes; replayed against that flicker, the old rule jumped the camera
1.35 m in a single frame where the current one moves 0.16 m.

The Kalam statue is the supplied Meshy sculpt, reduced from 3.07 million
triangles to about 34 thousand by `../prepare_statue.py`, with crevice shading
baked into vertex colours so it reads as cast bronze without a texture. The
bicycles are built in code, so they cost no download.

The recreation has approximate exterior dimensions. The concert and its
audience, sky, day and night, street lights, surface weathering, grass,
bicycles, other students and sound are web scene additions; the Blender files
in `../output` contain the editable campus, library and player.
