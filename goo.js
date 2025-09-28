// ==================== GOO ORCHESTRATOR ====================
// Coordinates mesh physics and rendering for interactive node mesh builder

// ==================== CONFIGURATION ====================
const WIDTH = window.innerWidth, HEIGHT = window.innerHeight;
const GROUND_Y = HEIGHT - 90;
const CURSOR_R = 10;

// Initialize mesh with physics configuration
const mesh = new Mesh({
  gravity: { x: 0, y: 175 },
  damping: 0.995,
  solverIterations: 6,
  stiffness: 0.25,
  wallRestitution: 0.25,
  groundRestitution: 0.18,
  friction: 0.85,
  bounds: { width: WIDTH, height: HEIGHT },
  groundY: GROUND_Y,
  defaultNodeRadius: 8,
  defaultNodeMass: 15
});

// Initialize renderer
const renderer = new MeshRenderer({
  nodeRadius: 8,
  cursorRadius: CURSOR_R,
  groundHeight: 120
});

const app = renderer.initialize(WIDTH, HEIGHT, document.body);

// ==================== SIMULATION STATE ====================

// ==================== SCENE INITIALIZATION ====================
// Create initial triangle
mesh.createTriangle(WIDTH * 0.5, HEIGHT * 0.3, 70);

// ==================== INPUT STATE ====================
// Input state
let mouse = { x: WIDTH * 0.7, y: HEIGHT * 0.2 };
let isDeleteMode = false;
let hoveredNode = null;

// ==================== INTERACTION HELPERS ====================

// ==================== MAIN SIMULATION LOOP ====================
app.ticker.add(() => {
  // Update interaction state
  hoveredNode = mesh.getNodeAt(mouse.x, mouse.y);
  isDeleteMode = hoveredNode !== null;

  // Update renderer state
  renderer.setCursor(mouse.x, mouse.y);
  renderer.setDeleteMode(isDeleteMode, hoveredNode);

  // Step physics simulation
  mesh.step();

  // Render frame
  renderer.render(mesh, GROUND_Y);
});


// ==================== INPUT HANDLING ====================
renderer.getCanvas().addEventListener('pointermove', (e) => {
  const worldPos = renderer.screenToWorld(e.clientX, e.clientY);
  mouse.x = worldPos.x;
  mouse.y = worldPos.y;
});

renderer.getCanvas().addEventListener('pointerdown', handleClick);

function handleClick() {
  if (isDeleteMode && hoveredNode) {
    // Delete mode - remove the hovered node
    mesh.removeNode(hoveredNode);
    return;
  }

  // Add mode - try to add a new node
  const nearest = mesh.getNearestNodes(mouse.x, mouse.y, 2);
  if (nearest.length < 2) return;

  // Check which connections are valid (don't cross existing links)
  const tempCursor = { x: mouse.x, y: mouse.y };
  const canConnect1 = !mesh.wouldLinkCross(tempCursor, nearest[0]);
  const canConnect2 = !mesh.wouldLinkCross(tempCursor, nearest[1]);

  // Only commit if BOTH connections are valid (need at least 2 connections)
  if (!canConnect1 || !canConnect2) return;

  // Create new node with initial downward velocity
  const newNode = mesh.createNode(mouse.x, mouse.y, {
    radius: CURSOR_R,
    initialVelocity: { x: 0, y: 3 }
  });

  // Create both links with stronger support characteristics
  mesh.createLink(newNode, nearest[0], { stiffness: mesh.stiffness * 1.5, restMultiplier: 0.85 });
  mesh.createLink(newNode, nearest[1], { stiffness: mesh.stiffness * 1.5, restMultiplier: 0.85 });

  // Add angle constraint to prevent bending
  mesh.createAngleConstraint(nearest[0], newNode, nearest[1], 0.5);
}

// ==================== WINDOW RESIZE ====================
window.addEventListener('resize', () => {
  const newWidth = window.innerWidth;
  const newHeight = window.innerHeight;

  renderer.resize(newWidth, newHeight);
  mesh.setBounds(newWidth, newHeight);
  mesh.setGroundY(newHeight - 90);
});