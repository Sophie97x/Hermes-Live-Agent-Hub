import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import PixelOfficeScene, { FLOORS, SCENE_KEY } from '../pixel/PixelOfficeScene';
import './PixelOffice.css';

function PixelOffice({ agents = [], selectedAgent, onSelectAgent }) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const onSelectAgentRef = useRef(onSelectAgent);
  const [sceneReady, setSceneReady] = useState(false);
  const [floor, setFloor] = useState('floor1');
  const [offFloorCount, setOffFloorCount] = useState(0);

  useEffect(() => {
    onSelectAgentRef.current = onSelectAgent;
  }, [onSelectAgent]);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return undefined;

    let cancelled = false;
    setSceneReady(false);

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: '#12101a',
      pixelArt: true,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: PixelOfficeScene,
    });

    // The scene isn't in game.scene.keys until the SceneManager's own
    // 'ready' listener (registered before ours, during Game construction)
    // has run its boot queue, so 'create' can only be attached safely
    // once game 'ready' has fired.
    game.events.once('ready', () => {
      if (cancelled) return;
      const scene = game.scene.keys[SCENE_KEY];
      if (!scene) return;
      scene.onSelectAgent = (agent) => onSelectAgentRef.current?.(agent);
      scene.events.once('create', () => {
        if (cancelled) return;
        sceneRef.current = scene;
        // The scene already built floor1 as part of its own create(); the
        // sync effect below (keyed on sceneReady) applies whatever agents
        // props are current the moment this flips, so nothing is stashed.
        setSceneReady(true);
      });
    });

    return () => {
      cancelled = true;
      sceneRef.current = null;
      // `true` also removes the canvas from the DOM, so React 18 StrictMode's
      // mount→unmount→remount in dev never leaves a stale canvas or a
      // second live WebGL context behind.
      game.destroy(true);
    };
  }, []);

  // Single effect drives both floor switches and agent-roster updates: if
  // the requested floor differs from what the scene currently has built,
  // rebuild it first (tearing down the previous floor's sprites), then
  // (re)seat agents either way. This runs on every polled agents/selection
  // update too, so a floor switch never needs a separate "resync" step.
  useEffect(() => {
    if (!sceneReady || !sceneRef.current) return;
    const scene = sceneRef.current;
    if (scene.currentFloorId !== floor) {
      scene.loadFloor(floor);
    }
    const result = scene.syncAgents(agents, selectedAgent?.id);
    setOffFloorCount(result?.offFloorCount ?? 0);
  }, [floor, agents, selectedAgent, sceneReady]);

  const openAgentFromPicker = (event) => {
    const agent = agents.find((entry) => String(entry.id) === event.target.value);
    if (agent) onSelectAgent?.(agent);
  };

  return (
    <div className="pixel-office-frame" aria-busy={!sceneReady}>
      <div className="pixel-floor-tabs" role="group" aria-label="Office floor">
        {FLOORS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={floor === entry.id ? 'active' : ''}
            aria-pressed={floor === entry.id}
            onClick={() => setFloor(entry.id)}
          >
            {entry.label}
          </button>
        ))}
        <div className="pixel-floor-actions">
          {offFloorCount > 0 && (
            <span className="pixel-floor-elsewhere" aria-live="polite">{offFloorCount} agent{offFloorCount === 1 ? '' : 's'} on other floors</span>
          )}
          <select className="pixel-agent-picker" aria-label="Open agent profile" value="" onChange={openAgentFromPicker} disabled={!agents.length}>
            <option value="">{agents.length ? 'Open agent…' : 'No agents available'}</option>
            {agents.map((agent) => <option key={agent.id} value={String(agent.id)}>{agent.name}</option>)}
          </select>
        </div>
      </div>
      <div className="pixel-office-canvas" ref={containerRef} aria-hidden="true" />
      <p className="pixel-office-hint">Drag to pan &middot; scroll to zoom</p>
    </div>
  );
}

export default PixelOffice;
