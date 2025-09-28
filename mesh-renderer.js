// ==================== MESH RENDERER ====================
// UI/UX rendering layer for mesh visualization using PIXI.js
// Handles all visual representation and user interaction feedback

class MeshRenderer {
  constructor(config = {}) {
    // Visual parameters
    this.nodeRadius = config.nodeRadius || 8;
    this.cursorRadius = config.cursorRadius || 10;
    this.groundHeight = config.groundHeight || 120;

    // Colors (can be customized by user)
    this.colors = {
      background: config.colors?.background || 0x0f1020,
      ground: config.colors?.ground || 0xffffff,
      links: config.colors?.links || 0x6aa8ff,
      nodes: config.colors?.nodes || 0xdde7ff,
      cursor: config.colors?.cursor || 0xffffff,
      validConnection: config.colors?.validConnection || 0x9bd1ff,
      invalidConnection: config.colors?.invalidConnection || 0xff6666,
      deleteHighlight: config.colors?.deleteHighlight || 0xff4444,
      hudBackground: config.colors?.hudBackground || 0x12142d,
      hudText: config.colors?.hudText || 0xbfc8ff
    };

    // Visual properties
    this.linkWidth = config.linkWidth || 6;
    this.linkAlpha = config.linkAlpha || 0.26;
    this.previewLinkWidth = config.previewLinkWidth || 4;
    this.previewLinkAlpha = config.previewLinkAlpha || 0.55;

    // PIXI setup
    this.app = null;
    this.layers = {};
    this.hudText = null;

    // State for interactive feedback
    this.cursor = { x: 0, y: 0 };
    this.isDeleteMode = false;
    this.hoveredNode = null;
    this.showConnectionPreview = true;
    this.showHUD = true;
  }

  // ==================== INITIALIZATION ====================

  initialize(width, height, containerElement = document.body) {
    this.app = new PIXI.Application({
      width: width,
      height: height,
      backgroundAlpha: 0,
      antialias: true
    });

    containerElement.appendChild(this.app.view);

    // Create rendering layers
    this.layers.ground = new PIXI.Graphics();
    this.layers.links = new PIXI.Graphics();
    this.layers.ghost = new PIXI.Graphics();
    this.layers.nodes = new PIXI.Graphics();

    this.app.stage.addChild(
      this.layers.ground,
      this.layers.links,
      this.layers.ghost,
      this.layers.nodes
    );

    // Setup HUD text
    if (this.showHUD) {
      const hudStyle = new PIXI.TextStyle({
        fill: this.colors.hudText,
        fontSize: 13
      });
      this.hudText = new PIXI.Text("", hudStyle);
      this.hudText.alpha = 0.9;
      this.app.stage.addChild(this.hudText);
    }

    return this.app;
  }

  // ==================== RENDERING METHODS ====================

  render(mesh, groundY) {
    this._clearLayers();
    this._renderGround(groundY);
    this._renderLinks(mesh.getLinks());
    this._renderGhostElements(mesh);
    this._renderNodes(mesh.getNodes());
    this._renderCursor();
    this._renderHUD();
  }

  _clearLayers() {
    Object.values(this.layers).forEach(layer => layer.clear());
  }

  _renderGround(groundY) {
    this.layers.ground.beginFill(this.colors.ground, 1);
    this.layers.ground.drawRect(0, groundY, this.app.renderer.width, this.groundHeight);
    this.layers.ground.endFill();
  }

  _renderLinks(links) {
    this.layers.links.lineStyle(this.linkWidth, this.colors.links, this.linkAlpha);
    for (const link of links) {
      this.layers.links.moveTo(link.a.x, link.a.y);
      this.layers.links.lineTo(link.b.x, link.b.y);
    }
  }

  _renderGhostElements(mesh) {
    if (this.isDeleteMode && this.hoveredNode) {
      this._renderDeleteHighlight();
    } else if (this.showConnectionPreview) {
      this._renderConnectionPreview(mesh);
    }
  }

  _renderDeleteHighlight() {
    this.layers.ghost.lineStyle(3, this.colors.deleteHighlight, 1.0);
    this.layers.ghost.beginFill(this.colors.deleteHighlight, 0.3);
    this.layers.ghost.drawCircle(
      this.hoveredNode.x,
      this.hoveredNode.y,
      this.hoveredNode.r + 3
    );
    this.layers.ghost.endFill();
  }

  _renderConnectionPreview(mesh) {
    const nearest = mesh.getNearestNodes(this.cursor.x, this.cursor.y, 2);
    if (nearest.length === 2) {
      const canConnect1 = !mesh.wouldLinkCross(this.cursor, nearest[0]);
      const canConnect2 = !mesh.wouldLinkCross(this.cursor, nearest[1]);

      this._drawConnectionLine(nearest[0], canConnect1);
      this._drawConnectionLine(nearest[1], canConnect2);
    }
  }

  _drawConnectionLine(target, isValid) {
    const color = isValid ? this.colors.validConnection : this.colors.invalidConnection;
    this.layers.ghost.lineStyle(this.previewLinkWidth, color, this.previewLinkAlpha);
    this.layers.ghost.moveTo(this.cursor.x, this.cursor.y);
    this.layers.ghost.lineTo(target.x, target.y);
  }

  _renderNodes(nodes) {
    for (const node of nodes) {
      this.layers.nodes.beginFill(this.colors.nodes, 1);
      this.layers.nodes.drawCircle(node.x, node.y, node.r);
      this.layers.nodes.endFill();
    }
  }

  _renderCursor() {
    if (!this.isDeleteMode) {
      this.layers.nodes.beginFill(this.colors.cursor, 1);
      this.layers.nodes.drawCircle(this.cursor.x, this.cursor.y, this.cursorRadius);
      this.layers.nodes.endFill();
    }
  }

  _renderHUD() {
    if (!this.showHUD || !this.hudText) return;

    // Draw HUD background
    this.layers.nodes.lineStyle(0);
    this.layers.nodes.beginFill(this.colors.hudBackground, 1);
    this.layers.nodes.drawRect(0, this.app.renderer.height - 40, this.app.renderer.width, 40);
    this.layers.nodes.endFill();

    // Draw HUD text
    const text = "Click to add nodes connected to nearest neighbors. Hover over nodes to delete.";
    this.hudText.text = text;
    this.hudText.position.set(12, this.app.renderer.height - 18);
  }

  // ==================== INTERACTION STATE ====================

  setCursor(x, y) {
    this.cursor.x = x;
    this.cursor.y = y;
  }

  setDeleteMode(enabled, hoveredNode = null) {
    this.isDeleteMode = enabled;
    this.hoveredNode = hoveredNode;
  }

  setConnectionPreview(enabled) {
    this.showConnectionPreview = enabled;
  }

  setHUD(enabled) {
    this.showHUD = enabled;
    if (this.hudText) {
      this.hudText.visible = enabled;
    }
  }

  // ==================== CUSTOMIZATION ====================

  setColors(colorOverrides) {
    this.colors = { ...this.colors, ...colorOverrides };
  }

  setLinkStyle(width, alpha) {
    this.linkWidth = width;
    this.linkAlpha = alpha;
  }

  setPreviewLinkStyle(width, alpha) {
    this.previewLinkWidth = width;
    this.previewLinkAlpha = alpha;
  }

  // ==================== UTILITY ====================

  resize(width, height) {
    if (this.app) {
      this.app.renderer.resize(width, height);
    }
  }

  getCanvas() {
    return this.app ? this.app.view : null;
  }

  getPixiApp() {
    return this.app;
  }

  destroy() {
    if (this.app) {
      this.app.destroy(true, true);
    }
  }

  // ==================== INPUT HELPERS ====================

  screenToWorld(clientX, clientY) {
    if (!this.app) return { x: clientX, y: clientY };

    const rect = this.app.view.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (this.app.renderer.width / rect.width),
      y: (clientY - rect.top) * (this.app.renderer.height / rect.height)
    };
  }
}

// Export for use in other modules or browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MeshRenderer };
}