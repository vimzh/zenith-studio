// Zenith Studio → Phaser 3
function preload() {
  this.load.atlas('agent-i-o-fixture', 'agent-i-o-fixture.png', 'agent-i-o-fixture.json');
}

function create() {
  this.anims.create({
    key: 'agent-i-o-fixture',
    frames: this.anims.generateFrameNames('agent-i-o-fixture', { start: 0, end: 3 }),
    frameRate: 4,
    repeat: -1,
  });
}

// Pixel art needs this in your game config, or Phaser smooths the texture:
//   { pixelArt: true }
