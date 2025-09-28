// ==================== CONFIGURATION ====================
// Physics Parameters
const WIDTH = window.innerWidth, HEIGHT = window.innerHeight;
const GRAVITY = { x: 0, y: 175 };          // Force pulling nodes downward (higher = faster falling)
const DAMPING = 0.995;                     // Velocity decay per frame (lower = more air resistance)
const SOLVER_ITER = 6;                     // Constraint iterations per frame (higher = more rigid but slower)
const STIFFNESS = 0.25;                    // Link constraint strength (higher = less stretchy connections)

// Visual Parameters
const NODE_R = 8;                          // Node radius for rendering and collision
const CURSOR_R = 10;                       // Cursor radius for rendering

// Collision Parameters
const WALL_RESTITUTION = 0.25;             // Bounce factor for wall collisions (0=sticky, 1=perfect bounce)
const RESTITUTION = 0.18;                  // Ground bounce factor (0=no bounce, 1=perfect bounce)
const FRICTION = 0.85;                     // Ground friction (0=ice, 1=sticky)

// Ground Configuration
const GROUND_Y = HEIGHT - 90;              // Y position of ground surface
const GROUND_H = 120;                      // Ground thickness for visual rendering

// ==================== GRAPHICS SETUP ====================
const app = new PIXI.Application({ width: WIDTH, height: HEIGHT, backgroundAlpha: 0, antialias: true });
document.body.appendChild(app.view);

const groundLayer = new PIXI.Graphics();
const linkLayer   = new PIXI.Graphics();
const ghostLayer  = new PIXI.Graphics();
const nodeLayer   = new PIXI.Graphics();
app.stage.addChild(groundLayer, linkLayer, ghostLayer, nodeLayer);

// ==================== PHYSICS CLASSES ====================
class Node {
  constructor(x, y, r = NODE_R, mass = 15, pinned = false) {
    this.x = x; this.y = y;
    this.px = x; this.py = y;
    this.ax = 0; this.ay = 0;
    this.r = r; this.mass = mass;
    this.pinned = pinned;
  }
  applyForce(fx, fy) { this.ax += fx / this.mass; this.ay += fy / this.mass; }
  integrate(dt) {
    if (this.pinned) { this.px = this.x; this.py = this.y; this.ax = this.ay = 0; return; }
    let vx = (this.x - this.px) * DAMPING;
    let vy = (this.y - this.py) * DAMPING;

    let newX = this.x + vx + this.ax * dt * dt;
    let newY = this.y + vy + this.ay * dt * dt;

    this.px = this.x;
    this.py = this.y;
    this.x = newX;
    this.y = newY;
    this.ax = 0; this.ay = 0;
  }
  boundsNoFloor() {
    if (this.x < this.r) { this.x = this.r; this.px = this.x + (this.x - this.px) * -WALL_RESTITUTION; }
    if (this.x > app.renderer.width - this.r) { this.x = app.renderer.width - this.r; this.px = this.x + (this.x - this.px) * -WALL_RESTITUTION; }
    if (this.y < this.r) { this.y = this.r; this.py = this.y + (this.y - this.py) * -WALL_RESTITUTION; }
  }
}

class Link {
  constructor(a, b, stiffness = STIFFNESS, restMultiplier = 0.95) {
    this.a = a; this.b = b;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    this.rest = Math.hypot(dx, dy) * restMultiplier;
    this.stiffness = stiffness;
  }
  satisfy() {
    const ax = this.a.x, ay = this.a.y;
    const bx = this.b.x, by = this.b.y;
    const dx = bx - ax, dy = by - ay;
    const d = Math.hypot(dx, dy) || 1e-6;
    const diff = (d - this.rest) / d;

    const factor = 0.5 * this.stiffness;
    const ox = dx * diff * factor;
    const oy = dy * diff * factor;

    if (!this.a.pinned) { this.a.x += ox; this.a.y += oy; }
    if (!this.b.pinned) { this.b.x -= ox; this.b.y -= oy; }
  }
}

class AngleConstraint {
  constructor(a, b, c, stiffness = 0.8) {
    this.a = a; this.b = b; this.c = c; // b is the center node
    this.stiffness = stiffness;
    // Calculate initial distance between outer nodes (simpler approach)
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    this.restDistance = Math.hypot(dx, dy);
  }

  satisfy() {
    // This is a simpler, more stable approach: maintain the distance between the outer nodes
    // This prevents bending without creating rotational forces
    const dx = this.c.x - this.a.x;
    const dy = this.c.y - this.a.y;
    const currentDist = Math.hypot(dx, dy) || 1e-6;

    const diff = (currentDist - this.restDistance) / currentDist;
    const correction = diff * this.stiffness * 0.25;

    const correctionX = dx * correction;
    const correctionY = dy * correction;

    // Only apply if both outer nodes are free (don't affect the center node)
    if (!this.a.pinned && !this.c.pinned) {
      this.a.x += correctionX * 0.5;
      this.a.y += correctionY * 0.5;
      this.c.x -= correctionX * 0.5;
      this.c.y -= correctionY * 0.5;
    }
  }
}

// ==================== SIMULATION STATE ====================
const nodes = [];
const links = [];
const angleConstraints = [];

// ==================== SCENE INITIALIZATION ====================
function spawnTriangleTouchingGround(cx, size = 70) {
  const startY = HEIGHT * 0.3; // Start well above ground
  const A = new Node(cx, startY);                     // top
  const B = new Node(cx - size * 0.9, startY + size); // left base
  const C = new Node(cx + size * 0.9, startY + size); // right base

  // Give initial downward velocity by setting previous positions higher
  A.py = A.y - 2;
  B.py = B.y - 2;
  C.py = C.y - 2;

  nodes.push(A, B, C);
  links.push(new Link(A, B, STIFFNESS, 1.0));
  links.push(new Link(B, C, STIFFNESS, 1.0));
  links.push(new Link(C, A, STIFFNESS, 1.0));

  // Add angle constraints to maintain shape
  angleConstraints.push(new AngleConstraint(A, B, C, 0.3));
  angleConstraints.push(new AngleConstraint(B, C, A, 0.3));
  angleConstraints.push(new AngleConstraint(C, A, B, 0.3));

  return [A, B, C];
}

spawnTriangleTouchingGround(WIDTH * 0.5, 70);

// ==================== INPUT STATE ====================
// Cursor (non-physical until committed)
let cursor = new Node(WIDTH * 0.7, HEIGHT * 0.2, CURSOR_R, 15, false);
cursor.isCursor = true;

// Input state
let mouse = { x: cursor.x, y: cursor.y };
let isDeleteMode = false;
let hoveredNode = null;

// ==================== UTILITY FUNCTIONS ====================
function nearestK(target, pool, k = 2) {
  const arr = pool.map(n => ({
    n,
    d2: (n.x - target.x) ** 2 + (n.y - target.y) ** 2
  })).sort((a, b) => a.d2 - b.d2);
  return arr.slice(0, k).map(o => o.n);
}

function getClickedNode(mouseX, mouseY) {
  for (const node of nodes) {
    const dx = node.x - mouseX;
    const dy = node.y - mouseY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= node.r) {
      return node;
    }
  }
  return null;
}

function removeNode(nodeToRemove) {
  // Find nodes that will become orphaned after removing this node
  const connectedNodes = [];
  for (const link of links) {
    if (link.a === nodeToRemove) {
      connectedNodes.push(link.b);
    } else if (link.b === nodeToRemove) {
      connectedNodes.push(link.a);
    }
  }

  // Remove all links connected to this node
  for (let i = links.length - 1; i >= 0; i--) {
    const link = links[i];
    if (link.a === nodeToRemove || link.b === nodeToRemove) {
      links.splice(i, 1);
    }
  }

  // Remove all angle constraints connected to this node
  for (let i = angleConstraints.length - 1; i >= 0; i--) {
    const constraint = angleConstraints[i];
    if (constraint.a === nodeToRemove || constraint.b === nodeToRemove || constraint.c === nodeToRemove) {
      angleConstraints.splice(i, 1);
    }
  }

  // Remove the node itself
  const nodeIndex = nodes.indexOf(nodeToRemove);
  if (nodeIndex !== -1) {
    nodes.splice(nodeIndex, 1);
  }

  // Check if any connected nodes now have insufficient connections and remove them
  for (const connectedNode of connectedNodes) {
    const connectionCount = links.filter(link =>
      link.a === connectedNode || link.b === connectedNode
    ).length;

    // If node has less than 2 connections, remove it recursively
    if (connectionCount < 2) {
      removeNode(connectedNode);
    }
  }
}

function lineIntersection(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
  const denom = (p1x - p2x) * (p3y - p4y) - (p1y - p2y) * (p3x - p4x);
  if (Math.abs(denom) < 1e-10) return null; // parallel or coincident

  const t = ((p1x - p3x) * (p3y - p4y) - (p1y - p3y) * (p3x - p4x)) / denom;
  const u = -((p1x - p2x) * (p1y - p3y) - (p1y - p2y) * (p1x - p3x)) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: p1x + t * (p2x - p1x),
      y: p1y + t * (p2y - p1y),
      t: t,
      u: u
    };
  }
  return null;
}

function wouldLinkCross(fromNode, toNode) {
  for (const link of links) {
    // Skip if the link shares a node with our proposed connection
    if (link.a === fromNode || link.a === toNode ||
        link.b === fromNode || link.b === toNode) continue;

    const intersection = lineIntersection(
      fromNode.x, fromNode.y, toNode.x, toNode.y,
      link.a.x, link.a.y, link.b.x, link.b.y
    );

    if (intersection) return true;
  }
  return false;
}

function preventLinkCrossings() {
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      const link1 = links[i];
      const link2 = links[j];

      // Skip if links share a node
      if (link1.a === link2.a || link1.a === link2.b ||
          link1.b === link2.a || link1.b === link2.b) continue;

      const intersection = lineIntersection(
        link1.a.x, link1.a.y, link1.b.x, link1.b.y,
        link2.a.x, link2.a.y, link2.b.x, link2.b.y
      );

      if (intersection) {
        const ix = intersection.x;
        const iy = intersection.y;

        // Only apply force if intersection is not too close to any node
        const minDistToNode = Math.min(
          Math.hypot(link1.a.x - ix, link1.a.y - iy),
          Math.hypot(link1.b.x - ix, link1.b.y - iy),
          Math.hypot(link2.a.x - ix, link2.a.y - iy),
          Math.hypot(link2.b.x - ix, link2.b.y - iy)
        );

        if (minDistToNode > NODE_R) {
          // Push nodes apart to prevent crossing - gentler force
          const pushStrength = 0.3;

          // Push link1 nodes away from intersection
          const dx1a = link1.a.x - ix;
          const dy1a = link1.a.y - iy;
          const dx1b = link1.b.x - ix;
          const dy1b = link1.b.y - iy;
          const dist1a = Math.hypot(dx1a, dy1a) || 1e-6;
          const dist1b = Math.hypot(dx1b, dy1b) || 1e-6;

          if (!link1.a.pinned) {
            link1.a.x += (dx1a / dist1a) * pushStrength;
            link1.a.y += (dy1a / dist1a) * pushStrength;
          }
          if (!link1.b.pinned) {
            link1.b.x += (dx1b / dist1b) * pushStrength;
            link1.b.y += (dy1b / dist1b) * pushStrength;
          }

          // Push link2 nodes away from intersection
          const dx2a = link2.a.x - ix;
          const dy2a = link2.a.y - iy;
          const dx2b = link2.b.x - ix;
          const dy2b = link2.b.y - iy;
          const dist2a = Math.hypot(dx2a, dy2a) || 1e-6;
          const dist2b = Math.hypot(dx2b, dy2b) || 1e-6;

          if (!link2.a.pinned) {
            link2.a.x += (dx2a / dist2a) * pushStrength;
            link2.a.y += (dy2a / dist2a) * pushStrength;
          }
          if (!link2.b.pinned) {
            link2.b.x += (dx2b / dist2b) * pushStrength;
            link2.b.y += (dy2b / dist2b) * pushStrength;
          }
        }
      }
    }
  }
}

function collideNodeWithGround(n) {
  if (n.pinned) return;
  const top = GROUND_Y;
  const pen = n.y - (top - n.r);

  if (pen > 0) {
    // Position correction to prevent sinking
    n.y = top - n.r;

    // Get velocity from verlet integration
    let vx = n.x - n.px;
    let vy = n.y - n.py;

    // Apply collision response if moving into ground
    if (vy > 0) {
      const vn = vy;   // normal velocity (y)
      const vt = vx;   // tangent velocity (x)
      const vnAfter = -vn * RESTITUTION;
      const vtAfter = vt * FRICTION;

      n.px = n.x - vtAfter;
      n.py = n.y - vnAfter;
    }
  }
}

// ==================== PHYSICS SIMULATION ====================
app.ticker.add(() => {
  const dt = 1/60; // Fixed timestep for stable physics

  // Update cursor mode based on proximity to nodes
  hoveredNode = getClickedNode(mouse.x, mouse.y);
  isDeleteMode = hoveredNode !== null;

  // Cursor follows mouse (no physics)
  cursor.x = mouse.x; cursor.y = mouse.y;
  cursor.px = cursor.x; cursor.py = cursor.y;

  // Apply gravity to all nodes
  for (const n of nodes) {
    n.applyForce(GRAVITY.x * n.mass, GRAVITY.y * n.mass);
  }

  // Integrate physics (Verlet integration)
  for (const n of nodes) {
    n.integrate(dt);
  }

  // Constraint solving iterations
  for (let iteration = 0; iteration < SOLVER_ITER; iteration++) {
    // Wall collisions (no floor)
    for (const n of nodes) {
      n.boundsNoFloor();
    }

    // Ground collisions
    for (const n of nodes) {
      collideNodeWithGround(n);
    }

    // Prevent link crossings
    preventLinkCrossings();

    // Distance constraints
    for (const link of links) {
      link.satisfy();
    }

    // Angle constraints (prevent bending)
    for (const constraint of angleConstraints) {
      constraint.satisfy();
    }

    // Prevent crossings again after constraint solving
    preventLinkCrossings();
  }

  render();
});

// ==================== RENDERING ====================
function render() {
  // Draw ground
  groundLayer.clear();
  groundLayer.beginFill(0xffffff, 1);
  groundLayer.drawRect(0, GROUND_Y, app.renderer.width, GROUND_H);
  groundLayer.endFill();

  // Draw links
  linkLayer.clear();
  linkLayer.lineStyle(6, 0x6aa8ff, 0.26);
  for (const link of links) {
    linkLayer.moveTo(link.a.x, link.a.y);
    linkLayer.lineTo(link.b.x, link.b.y);
  }

  // Draw ghost preview (cursor feedback)
  ghostLayer.clear();

  if (isDeleteMode && hoveredNode) {
    // Delete mode - highlight the hovered node in red
    ghostLayer.lineStyle(3, 0xff4444, 1.0);
    ghostLayer.beginFill(0xff4444, 0.3);
    ghostLayer.drawCircle(hoveredNode.x, hoveredNode.y, hoveredNode.r + 3);
    ghostLayer.endFill();
  } else {
    // Add mode - show connection preview
    const nearest = nearestK(cursor, nodes, 2);
    if (nearest.length === 2) {
      const canConnect1 = !wouldLinkCross(cursor, nearest[0]);
      const canConnect2 = !wouldLinkCross(cursor, nearest[1]);

      if (canConnect1 || canConnect2) {
        // Draw valid connections in blue, invalid in red
        const drawConnection = (target, isValid) => {
          ghostLayer.lineStyle(4, isValid ? 0x9bd1ff : 0xff6666, 0.55);
          ghostLayer.moveTo(cursor.x, cursor.y);
          ghostLayer.lineTo(target.x, target.y);
        };

        drawConnection(nearest[0], canConnect1);
        drawConnection(nearest[1], canConnect2);
      } else {
        // Neither connection is valid - show both in red
        ghostLayer.lineStyle(4, 0xff6666, 0.55);
        ghostLayer.moveTo(cursor.x, cursor.y);
        ghostLayer.lineTo(nearest[0].x, nearest[0].y);
        ghostLayer.moveTo(cursor.x, cursor.y);
        ghostLayer.lineTo(nearest[1].x, nearest[1].y);
      }
    }
  }

  // Draw nodes
  nodeLayer.clear();
  for (const node of nodes) {
    nodeLayer.beginFill(0xdde7ff, 1);
    nodeLayer.drawCircle(node.x, node.y, node.r);
    nodeLayer.endFill();
  }

  // Draw cursor (only in add mode)
  if (!isDeleteMode) {
    nodeLayer.beginFill(0xffffff, 1);
    nodeLayer.drawCircle(cursor.x, cursor.y, cursor.r);
    nodeLayer.endFill();
  }

  // Draw HUD
  nodeLayer.lineStyle(0);
  nodeLayer.beginFill(0x12142d, 1);
  nodeLayer.drawRect(0, app.renderer.height - 40, app.renderer.width, 40);
  nodeLayer.endFill();
  drawText("Click to add nodes connected to nearest neighbors. Hover over nodes to delete.", 12, app.renderer.height - 18);
}

const hudStyle = new PIXI.TextStyle({ fill: 0xbfc8ff, fontSize: 13 });
const hudText = new PIXI.Text("", hudStyle);
hudText.alpha = 0.9;
app.stage.addChild(hudText);

function drawText(text, x, y) {
  hudText.text = text;
  hudText.position.set(x, y);
}

// ==================== INPUT HANDLING ====================
app.view.addEventListener('pointermove', (e) => {
  const rect = app.view.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) * (app.renderer.width / rect.width);
  mouse.y = (e.clientY - rect.top) * (app.renderer.height / rect.height);
});
app.view.addEventListener('pointerdown', handleClick);

function handleClick() {
  if (isDeleteMode && hoveredNode) {
    // Delete mode - remove the hovered node
    removeNode(hoveredNode);
    return;
  }

  // Add mode - try to add a new node
  const nearest = nearestK(cursor, nodes, 2);
  if (nearest.length < 2) return;

  // Check which connections are valid (don't cross existing links)
  const canConnect1 = !wouldLinkCross(cursor, nearest[0]);
  const canConnect2 = !wouldLinkCross(cursor, nearest[1]);

  // Only commit if BOTH connections are valid (need at least 2 connections)
  if (!canConnect1 || !canConnect2) return;

  // Set up new node with initial downward velocity
  cursor.px = cursor.x;
  cursor.py = cursor.y - 3; // Give initial downward velocity
  nodes.push(cursor);

  // Create both links with stronger support characteristics
  links.push(new Link(cursor, nearest[0], STIFFNESS * 1.5, 0.85));
  links.push(new Link(cursor, nearest[1], STIFFNESS * 1.5, 0.85));

  // Add angle constraint to prevent bending
  angleConstraints.push(new AngleConstraint(nearest[0], cursor, nearest[1], 0.5));

  // Create new cursor for next placement
  cursor = new Node(mouse.x, mouse.y, CURSOR_R, 15, false);
  cursor.isCursor = true;
  cursor.px = cursor.x;
  cursor.py = cursor.y;
}

// ==================== WINDOW RESIZE ====================
window.addEventListener('resize', () => {
  app.renderer.resize(window.innerWidth, window.innerHeight);
});