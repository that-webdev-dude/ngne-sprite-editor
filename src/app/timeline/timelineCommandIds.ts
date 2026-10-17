// Ids of the commands the timeline panel runs (SE-022). The panel takes them from here, so it
// never loads a `*.commands.ts` module before the registry does (appCommands.ts).

export const TIMELINE_COMMANDS = {
    newLayer: "layer.new",
    duplicateLayer: "layer.duplicate",
    deleteLayer: "layer.delete",
    layerProperties: "layer.properties",
    applyLayerProperties: "layer.applyProperties",
    renameLayer: "layer.rename",
    applyLayerName: "layer.applyName",
    toggleVisible: "layer.toggleVisible",
    toggleLocked: "layer.toggleLocked",
    layerAbove: "layer.above",
    layerBelow: "layer.below",
    newFrame: "frame.new",
    newEmptyFrame: "frame.newEmpty",
    deleteFrame: "frame.delete",
    firstFrame: "frame.first",
    previousFrame: "frame.previous",
    nextFrame: "frame.next",
    lastFrame: "frame.last",
    previousFrameOnCanvas: "frame.previousOnCanvas",
    nextFrameOnCanvas: "frame.nextOnCanvas",
    setDuration: "frame.setDuration",
    toggleTimeline: "view.timeline",
} as const;

/** Play / Pause, planned in the Frame menu; SE-024 implements it. The transport shows it. */
export const PLAY_PAUSE_COMMAND = "frame.playPause";
