import type { SketchTool } from '../model';

type ToolbarProps = {
  tool: SketchTool;
  canUndo: boolean;
  canRedo: boolean;
  onToolChange: (tool: SketchTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onReset: () => void;
};

function ToolButton({ tool, current, icon, label, shortcut, onClick }: {
  tool: SketchTool;
  current: SketchTool;
  icon: string;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return <button
    className={`tool-button${current === tool ? ' active' : ''}`}
    type="button"
    title={shortcut ? `${label} · ${shortcut}` : label}
    aria-label={label}
    aria-pressed={current === tool}
    onClick={onClick}
  >
    <span className="tool-icon" aria-hidden="true">{icon}</span>
    <span className="tool-label">{label}</span>
    {shortcut && <kbd>{shortcut}</kbd>}
  </button>;
}

export default function Toolbar({ tool, canUndo, canRedo, onToolChange, onUndo, onRedo, onFit, onReset }: ToolbarProps) {
  const select = (next: SketchTool) => onToolChange(tool === next ? 'select' : next);
  return <nav className="toolbar" aria-label="Sketch tools">
    <div className="toolbar-group primary-tools">
      <ToolButton tool="select" current={tool} icon="↖" label="Select" shortcut="V" onClick={() => select('select')} />
      <ToolButton tool="pan" current={tool} icon="✥" label="Pan" shortcut="Space" onClick={() => select('pan')} />
      <ToolButton tool="add-pulley" current={tool} icon="◉" label="Add pulley" onClick={() => select('add-pulley')} />
      <ToolButton tool="add-idler" current={tool} icon="◎" label="Add tensioner" onClick={() => select('add-idler')} />
      <ToolButton tool="route" current={tool} icon="⌁" label="Create belt" onClick={() => select('route')} />
    </div>
    <span className="toolbar-divider" />
    <div className="toolbar-group dimension-tools">
      <ToolButton tool="dimension-horizontal" current={tool} icon="↔" label="Horizontal dimension" shortcut="X" onClick={() => select('dimension-horizontal')} />
      <ToolButton tool="dimension-vertical" current={tool} icon="↕" label="Vertical dimension" shortcut="Y" onClick={() => select('dimension-vertical')} />
      <ToolButton tool="dimension-aligned" current={tool} icon="⤡" label="Center distance" shortcut="D" onClick={() => select('dimension-aligned')} />
      <ToolButton tool="constraint-horizontal" current={tool} icon="━" label="Horizontal constraint" onClick={() => select('constraint-horizontal')} />
      <ToolButton tool="constraint-vertical" current={tool} icon="┃" label="Vertical constraint" onClick={() => select('constraint-vertical')} />
      <ToolButton tool="delete" current={tool} icon="⌫" label="Delete geometry" onClick={() => select('delete')} />
    </div>
    <div className="toolbar-spacer" />
    <div className="toolbar-group view-tools">
      <button className="icon-button" type="button" title="Fit view" aria-label="Fit view" onClick={onFit}>⌕</button>
      <button className="icon-button" type="button" title="Reset view" aria-label="Reset view" onClick={onReset}>⌂</button>
      <span className="toolbar-divider compact" />
      <button className="icon-button" type="button" title="Undo · Ctrl/⌘ Z" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>↶</button>
      <button className="icon-button" type="button" title="Redo · Ctrl/⌘ Shift Z" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>↷</button>
    </div>
  </nav>;
}
