# Local campus player

Double-click `../START_CAMPUS.cmd`, then open http://127.0.0.1:5173/. Keep its
terminal open while playing. Node.js must be installed (it is installed on this
laptop). To reach it from a phone, point your tunnel at the same port.

For editing, run `npm run dev`. After source changes run `npm run build`, which
updates the standalone version used by `npm start` and the launcher.

## Controls

Phone (the main target): a round thumb stick bottom left, round buttons bottom
right. Drag the stick to walk and push it to the rim to run. The chip just above
the stick is the sprint lock, and it works both ways round — tap it, or shove
the stick straight up onto it and let go. Locked, it runs forward on its own and
keeps pulsing so you cannot miss it; tap it again or pull the stick back to
stop, the same auto-run as BGMI. **Jump** hops. **Ride** appears when you are
within about three metres of the bicycle parked beside the sports complex;
riding is roughly four times walking pace and **Get off** parks it beside you.
Drag anywhere else to look, pinch to change the camera distance.

Desktop: WASD to walk, Shift to run, Space to jump, F to get on and off the
bicycle, R to return to the sports complex, Escape to pause.

The place list is the dropdown in the top bar; **Concert** puts you on the
football entrance sightline facing the stage, and **Campus overview** lifts to a
plan view. **Library** and **Lecture gallery** stay greyed out until the
outlying buildings finish streaming.

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
percentage on the start panel, and the outlying buildings (library and lecture
gallery) stream in afterwards while you are already exploring; a small chip
shows their progress and both destinations stay greyed out until they land. Over the wire the whole campus is
about 4.3 MB: `campus.glb` and `library.glb` are Draco-compressed, the character
and aerial textures are JPEG rather than PNG, and `scripts/serve.mjs` gzips
what is left. Uncompressed, the same assets were about 41 MB.

The two collision meshes are deliberately **not** Draco-compressed. Their floor
heights are asserted to the centimetre, and the test suite reads them without a
browser, where a Draco decoder needs a worker that Node does not provide.

## Notes

`npm test` checks player collisions, field spawn heights, the jump arc on the
real campus mesh, character animations, concert alignment, road continuity, the
statue budget, and that no tree is planted in a carriageway.

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
follow the graphics quality setting.

The student ships with Walk, Run, Idle and a cycling clip. Jumping has no clip,
so it is posed on top of whichever one is playing, blended by weight rather than
written over the bones — writing it outright snapped him into the modelling
T-pose whenever the weight rose above zero, which one bumpy frame was enough to
do.

The bicycle is built around the cycling clip rather than the rider being bent
onto a bicycle. At load the game samples where the hands, hips and feet actually
travel through that clip and puts the bars, saddle and cranks exactly there, so
nothing has to be posed at all; the cranks then read their angle off the rider's
own foot and can never fall out of step. The frame is lifted just enough that the
pedal circle clears the ground, since the clip swings the feet lower than a real
bottom bracket.

Riding is steered, not strafed: the stick's sideways axis turns the bicycle and
the turn rate falls away at a standstill, so it leans through a full circle
instead of spinning on the spot, and the camera eases round behind unless you
are dragging it.

Only the camera's boom *length* reacts to obstacles, and the position itself
always eases towards it. Snapping the camera on frames where its collision ray
found something and easing on frames where it missed shook the whole picture at
riding pace, because at 14.5 m/s that ray flickers on and off every kerb and
verge it passes; replayed against that flicker, the old rule jumped the camera
1.35 m in a single frame where the current one moves 0.16 m.

The Kalam statue is the supplied Meshy sculpt, reduced from 3.07 million
triangles to about 34 thousand by `../prepare_statue.py`, with crevice shading
baked into vertex colours so it reads as cast bronze without a texture. The
bicycle is built in code, so it costs no download.

The recreation has approximate exterior dimensions. The concert, sky, grass and
bicycle are web scene additions; the Blender files in `../output` contain the
editable campus, library and player.
