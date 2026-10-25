import type { Play, SceneSpec, StoryboardFrame } from '../types';

/**
 * Illustrative play diagram. A schematic stand-in for footage, drawn from
 * authored storyboard data. It is NOT real film, NOT tracking output and NOT
 * evidence of model performance — and the component says so on screen.
 */

const LOS_Y = 190;
const OL_Y = 218;
const DL_Y = 162;

const OFFENSE = [
  { id: 'LT', x: 200 },
  { id: 'LG', x: 260 }, // No. 62
  { id: 'C', x: 320 },
  { id: 'RG', x: 380 },
  { id: 'RT', x: 440 },
];

function guardPosition(scene: SceneSpec): { x: number; y: number } {
  switch (scene.defender) {
    case 'engaged':
      return { x: 270, y: 206 };
    case 'displaced':
      return { x: 292, y: 192 };
    case 'working_back':
      return { x: 276, y: 200 };
    case 'penetrating':
      return { x: 296, y: 208 };
    default:
      return scene.guardStep ? { x: 266, y: 212 } : { x: 260, y: OL_Y };
  }
}

function defenderPosition(scene: SceneSpec): { x: number; y: number } {
  switch (scene.defender) {
    case 'engaged':
      return { x: 286, y: 184 };
    case 'displaced':
      return { x: 318, y: 160 };
    case 'working_back':
      return { x: 268, y: 176 };
    case 'penetrating':
      return { x: 300, y: 246 };
    default:
      return { x: 286, y: DL_Y };
  }
}

function describe(frame: StoryboardFrame, index: number, total: number): string {
  const s = frame.scene;
  const parts: string[] = [`Illustrative diagram, frame ${index + 1} of ${total}: ${frame.neutralCaption}`];
  if (s.visibility === 'interior_lost') parts.push('The interior of the line is out of frame.');
  if (s.visibility === 'degraded') parts.push('The frame is rendered as low-resolution film.');
  if (s.visibility === 'partial') parts.push('Part of the engagement is obstructed.');
  if (s.identityUnresolved) parts.push('Two similar jersey numbers; the left guard is not confirmed.');
  if (s.jerseyObscured) parts.push('The jersey number is partly obscured.');
  return parts.join(' ');
}

export function PlayDiagram({
  play,
  frameIndex,
}: {
  play: Play;
  frameIndex: number;
}) {
  const frames = play.storyboard;
  const frame = frames[Math.min(Math.max(frameIndex, 0), frames.length - 1)];
  const scene = frame.scene;
  const degraded = scene.visibility === 'degraded' || Boolean(play.filmQuality.degraded);
  const guard = guardPosition(scene);
  const dt = defenderPosition(scene);
  const interiorLost = scene.visibility === 'interior_lost';

  return (
    <div className={`diagram${degraded ? ' degraded' : ''}`}>
      <svg
        viewBox="0 0 640 330"
        role="img"
        aria-label={describe(frame, frameIndex, frames.length)}
        className="diagram-svg"
      >
        <title>Illustrative play diagram — not footage</title>
        <desc>{describe(frame, frameIndex, frames.length)}</desc>

        {/* field */}
        <rect x="0" y="0" width="640" height="330" className="field" />
        {[60, 120, 250, 310].map((y) => (
          <line key={y} x1="40" x2="600" y1={y} y2={y} className="yard" />
        ))}
        <line x1="40" x2="600" y1={LOS_Y} y2={LOS_Y} className="los" />
        <text x="46" y={LOS_Y - 6} className="label">LOS</text>
        <text x="520" y="302" className="label">Play side → right</text>

        {/* second level */}
        <g className="defense">
          <text x="250" y="124" textAnchor="middle" className="player def">LB</text>
          <text x="390" y="124" textAnchor="middle" className="player def">LB</text>
          <text x="170" y={DL_Y + 5} textAnchor="middle" className="player def">DE</text>
          <text x="338" y={DL_Y + 5} textAnchor="middle" className="player def">N</text>
          <text x="400" y={DL_Y + 5} textAnchor="middle" className="player def">DT</text>
          <text x="470" y={DL_Y + 5} textAnchor="middle" className="player def">DE</text>
          {/* primary defender over the guard */}
          <g className={`primary-def ${scene.defender ?? 'aligned'}`}>
            <polygon
              points={`${dt.x},${dt.y - 12} ${dt.x + 12},${dt.y + 8} ${dt.x - 12},${dt.y + 8}`}
              className="def-shape"
            />
            <text x={dt.x} y={dt.y + 24} textAnchor="middle" className="label small">3T</text>
          </g>
        </g>

        {/* offense */}
        <g className="offense">
          {OFFENSE.filter((o) => o.id !== 'LG').map((o) => {
            const isCenterCombo = o.id === 'C' && scene.combo;
            const cx = isCenterCombo ? 300 : o.x;
            const cy = isCenterCombo ? 200 : OL_Y;
            return (
              <g key={o.id}>
                <circle cx={cx} cy={cy} r="13" className="ol" />
                <text x={cx} y={cy + 4} textAnchor="middle" className="player ol-label">
                  {o.id === 'C' && scene.identityUnresolved ? '66?' : o.id}
                </text>
              </g>
            );
          })}
          <circle cx="320" cy="274" r="11" className="back" />
          <text x="320" y="278" textAnchor="middle" className="player back-label">QB</text>
          <circle cx="282" cy="308" r="11" className="back" />
          <text x="282" y="312" textAnchor="middle" className="player back-label">RB</text>

          {/* No. 62 — highlighted */}
          <g className="guard">
            {scene.guardStep && (
              <line
                x1="260"
                y1={OL_Y}
                x2={guard.x + 16}
                y2={guard.y - 14}
                className="step-arrow"
                markerEnd="url(#arrow)"
              />
            )}
            {scene.combo && (
              <line x1={guard.x} y1={guard.y} x2="300" y2="200" className="combo-link" />
            )}
            {scene.climbPartial && (
              <line
                x1={guard.x}
                y1={guard.y}
                x2="252"
                y2="140"
                className="climb-arrow"
                markerEnd="url(#arrow)"
              />
            )}
            <circle cx={guard.x} cy={guard.y} r="15" className="ol primary" />
            <text x={guard.x} y={guard.y + 4} textAnchor="middle" className="player primary-label">
              {scene.identityUnresolved ? '62?' : scene.jerseyObscured ? '6▒' : '62'}
            </text>
            {/* hands at contact */}
            {scene.hands === 'inside' && (
              <g className="hands inside">
                <circle cx={dt.x - 4} cy={dt.y + 2} r="3" />
                <circle cx={dt.x + 4} cy={dt.y + 2} r="3" />
              </g>
            )}
            {scene.hands === 'not_fitted' && (
              <g className="hands late">
                <circle cx={dt.x - 14} cy={dt.y + 10} r="3" />
                <circle cx={dt.x + 14} cy={dt.y + 10} r="3" />
              </g>
            )}
            {scene.hands === 'high_outside' && (
              <g className="hands high">
                <circle cx={dt.x - 13} cy={dt.y - 10} r="3" />
                <circle cx={dt.x + 13} cy={dt.y - 10} r="3" />
              </g>
            )}
          </g>
        </g>

        {/* identity box */}
        {scene.identityUnresolved && (
          <g className="identity">
            <rect x="238" y="196" width="104" height="44" className="identity-box" />
            <text x="290" y="254" textAnchor="middle" className="label small">identity unresolved</text>
          </g>
        )}

        {/* partial obstruction */}
        {scene.visibility === 'partial' && (
          <g className="obstruction">
            <rect x={dt.x + 2} y={dt.y - 30} width="60" height="70" className="obstruct" />
            <text x={dt.x + 32} y={dt.y + 52} textAnchor="middle" className="label small">obstructed</text>
          </g>
        )}

        {/* interior out of frame */}
        {interiorLost && (
          <g className="lost">
            <rect x="140" y="100" width="360" height="160" className="lost-box" />
            <text x="320" y="176" textAnchor="middle" className="lost-label">Interior of the line out of frame</text>
            <text x="320" y="198" textAnchor="middle" className="label small">camera followed the ball</text>
          </g>
        )}

        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head" />
          </marker>
        </defs>
      </svg>
      {degraded && (
        <div className="degraded-banner" aria-hidden="true">
          Rendered as low-resolution film
        </div>
      )}
    </div>
  );
}
