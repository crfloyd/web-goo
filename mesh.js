// ==================== MESH PHYSICS LIBRARY ====================
// Pure physics implementation for connected node meshes
// Can be dropped into any project for mesh simulation

class Mesh {
  constructor(config = {}) {
    // Physics parameters
    this.gravity = config.gravity || { x: 0, y: 175 };
    this.damping = config.damping || 0.995;
    this.solverIterations = config.solverIterations || 6;
    this.stiffness = config.stiffness || 0.25;

    // Collision parameters
    this.wallRestitution = config.wallRestitution || 0.25;
    this.groundRestitution = config.groundRestitution || 0.18;
    this.friction = config.friction || 0.85;

    // Boundary configuration
    this.bounds = config.bounds || { width: 800, height: 600 };
    this.groundY = config.groundY || this.bounds.height - 90;

    // Node defaults
    this.defaultNodeRadius = config.defaultNodeRadius || 8;
    this.defaultNodeMass = config.defaultNodeMass || 15;

    // Internal state
    this.nodes = [];
    this.links = [];
    this.angleConstraints = [];
  }

  // ==================== NODE MANAGEMENT ====================

  createNode(x, y, options = {}) {
    const node = new Node(
      x, y,
      options.radius || this.defaultNodeRadius,
      options.mass || this.defaultNodeMass,
      options.pinned || false
    );

    if (options.initialVelocity) {
      node.px = x - options.initialVelocity.x;
      node.py = y - options.initialVelocity.y;
    }

    this.nodes.push(node);
    return node;
  }

  removeNode(node) {
    // Find connected nodes before removing links
    const connectedNodes = [];
    for (const link of this.links) {
      if (link.a === node) connectedNodes.push(link.b);
      else if (link.b === node) connectedNodes.push(link.a);
    }

    // Remove all links connected to this node
    this.links = this.links.filter(link =>
      link.a !== node && link.b !== node
    );

    // Remove all angle constraints connected to this node
    this.angleConstraints = this.angleConstraints.filter(constraint =>
      constraint.a !== node && constraint.b !== node && constraint.c !== node
    );

    // Remove the node itself
    const nodeIndex = this.nodes.indexOf(node);
    if (nodeIndex !== -1) {
      this.nodes.splice(nodeIndex, 1);
    }

    // Recursively remove orphaned nodes (less than 2 connections)
    for (const connectedNode of connectedNodes) {
      const connectionCount = this.links.filter(link =>
        link.a === connectedNode || link.b === connectedNode
      ).length;

      if (connectionCount < 2) {
        this.removeNode(connectedNode);
      }
    }
  }

  getNodeAt(x, y) {
    for (const node of this.nodes) {
      const dx = node.x - x;
      const dy = node.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= node.r) {
        return node;
      }
    }
    return null;
  }

  getNearestNodes(x, y, count = 2) {
    const target = { x, y };
    const candidates = this.nodes.map(n => ({
      node: n,
      distanceSquared: (n.x - target.x) ** 2 + (n.y - target.y) ** 2
    })).sort((a, b) => a.distanceSquared - b.distanceSquared);

    return candidates.slice(0, count).map(item => item.node);
  }

  // ==================== LINK MANAGEMENT ====================

  createLink(nodeA, nodeB, options = {}) {
    const link = new Link(
      nodeA, nodeB,
      options.stiffness || this.stiffness,
      options.restMultiplier || 0.95
    );
    this.links.push(link);
    return link;
  }

  createAngleConstraint(nodeA, nodeB, nodeC, stiffness = 0.8) {
    const constraint = new AngleConstraint(nodeA, nodeB, nodeC, stiffness);
    this.angleConstraints.push(constraint);
    return constraint;
  }

  wouldLinkCross(fromNode, toNode) {
    for (const link of this.links) {
      // Skip if the link shares a node with our proposed connection
      if (link.a === fromNode || link.a === toNode ||
          link.b === fromNode || link.b === toNode) continue;

      const intersection = this._lineIntersection(
        fromNode.x, fromNode.y, toNode.x, toNode.y,
        link.a.x, link.a.y, link.b.x, link.b.y
      );

      if (intersection) return true;
    }
    return false;
  }

  // ==================== SHAPE GENERATION ====================

  createTriangle(centerX, centerY, size = 70) {
    const nodeA = this.createNode(centerX, centerY, {
      initialVelocity: { x: 0, y: 2 }
    });
    const nodeB = this.createNode(centerX - size * 0.9, centerY + size, {
      initialVelocity: { x: 0, y: 2 }
    });
    const nodeC = this.createNode(centerX + size * 0.9, centerY + size, {
      initialVelocity: { x: 0, y: 2 }
    });

    this.createLink(nodeA, nodeB, { stiffness: this.stiffness, restMultiplier: 1.0 });
    this.createLink(nodeB, nodeC, { stiffness: this.stiffness, restMultiplier: 1.0 });
    this.createLink(nodeC, nodeA, { stiffness: this.stiffness, restMultiplier: 1.0 });

    this.createAngleConstraint(nodeA, nodeB, nodeC, 0.3);
    this.createAngleConstraint(nodeB, nodeC, nodeA, 0.3);
    this.createAngleConstraint(nodeC, nodeA, nodeB, 0.3);

    return [nodeA, nodeB, nodeC];
  }

  // ==================== PHYSICS SIMULATION ====================

  step(deltaTime = 1/60) {
    // Apply gravity to all nodes
    for (const node of this.nodes) {
      node.applyForce(this.gravity.x * node.mass, this.gravity.y * node.mass);
    }

    // Integrate physics (Verlet integration)
    for (const node of this.nodes) {
      node.integrate(deltaTime, this.damping);
    }

    // Constraint solving iterations
    for (let iteration = 0; iteration < this.solverIterations; iteration++) {
      // Wall collisions (no floor)
      for (const node of this.nodes) {
        this._applyWallBounds(node);
      }

      // Ground collisions
      for (const node of this.nodes) {
        this._applyGroundCollision(node);
      }

      // Prevent link crossings
      this._preventLinkCrossings();

      // Distance constraints
      for (const link of this.links) {
        link.satisfy();
      }

      // Angle constraints
      for (const constraint of this.angleConstraints) {
        constraint.satisfy();
      }

      // Prevent crossings again after constraint solving
      this._preventLinkCrossings();
    }
  }

  // ==================== PRIVATE METHODS ====================

  _applyWallBounds(node) {
    if (node.pinned) return;

    if (node.x < node.r) {
      node.x = node.r;
      node.px = node.x + (node.x - node.px) * -this.wallRestitution;
    }
    if (node.x > this.bounds.width - node.r) {
      node.x = this.bounds.width - node.r;
      node.px = node.x + (node.x - node.px) * -this.wallRestitution;
    }
    if (node.y < node.r) {
      node.y = node.r;
      node.py = node.y + (node.y - node.py) * -this.wallRestitution;
    }
  }

  _applyGroundCollision(node) {
    if (node.pinned) return;

    const penetration = node.y - (this.groundY - node.r);
    if (penetration > 0) {
      // Position correction
      node.y = this.groundY - node.r;

      // Velocity from verlet integration
      let vx = node.x - node.px;
      let vy = node.y - node.py;

      // Apply collision response if moving into ground
      if (vy > 0) {
        const vnAfter = -vy * this.groundRestitution;
        const vtAfter = vx * this.friction;

        node.px = node.x - vtAfter;
        node.py = node.y - vnAfter;
      }
    }
  }

  _preventLinkCrossings() {
    for (let i = 0; i < this.links.length; i++) {
      for (let j = i + 1; j < this.links.length; j++) {
        const link1 = this.links[i];
        const link2 = this.links[j];

        // Skip if links share a node
        if (link1.a === link2.a || link1.a === link2.b ||
            link1.b === link2.a || link1.b === link2.b) continue;

        const intersection = this._lineIntersection(
          link1.a.x, link1.a.y, link1.b.x, link1.b.y,
          link2.a.x, link2.a.y, link2.b.x, link2.b.y
        );

        if (intersection) {
          this._pushLinksApart(link1, link2, intersection);
        }
      }
    }
  }

  _pushLinksApart(link1, link2, intersection) {
    const ix = intersection.x;
    const iy = intersection.y;

    // Only apply force if intersection is not too close to any node
    const minDistToNode = Math.min(
      Math.hypot(link1.a.x - ix, link1.a.y - iy),
      Math.hypot(link1.b.x - ix, link1.b.y - iy),
      Math.hypot(link2.a.x - ix, link2.a.y - iy),
      Math.hypot(link2.b.x - ix, link2.b.y - iy)
    );

    if (minDistToNode > this.defaultNodeRadius) {
      const pushStrength = 0.3;

      // Push link1 nodes away from intersection
      this._pushNodeFromPoint(link1.a, ix, iy, pushStrength);
      this._pushNodeFromPoint(link1.b, ix, iy, pushStrength);

      // Push link2 nodes away from intersection
      this._pushNodeFromPoint(link2.a, ix, iy, pushStrength);
      this._pushNodeFromPoint(link2.b, ix, iy, pushStrength);
    }
  }

  _pushNodeFromPoint(node, px, py, strength) {
    if (node.pinned) return;

    const dx = node.x - px;
    const dy = node.y - py;
    const dist = Math.hypot(dx, dy) || 1e-6;

    node.x += (dx / dist) * strength;
    node.y += (dy / dist) * strength;
  }

  _lineIntersection(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
    const denom = (p1x - p2x) * (p3y - p4y) - (p1y - p2y) * (p3x - p4x);
    if (Math.abs(denom) < 1e-10) return null;

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

  // ==================== PUBLIC API ====================

  getNodes() { return this.nodes; }
  getLinks() { return this.links; }
  getAngleConstraints() { return this.angleConstraints; }

  setBounds(width, height) {
    this.bounds.width = width;
    this.bounds.height = height;
  }

  setGroundY(y) {
    this.groundY = y;
  }
}

// ==================== PHYSICS CLASSES ====================

class Node {
  constructor(x, y, r = 8, mass = 15, pinned = false) {
    this.x = x; this.y = y;
    this.px = x; this.py = y;
    this.ax = 0; this.ay = 0;
    this.r = r; this.mass = mass;
    this.pinned = pinned;
  }

  applyForce(fx, fy) {
    this.ax += fx / this.mass;
    this.ay += fy / this.mass;
  }

  integrate(dt, damping = 0.995) {
    if (this.pinned) {
      this.px = this.x;
      this.py = this.y;
      this.ax = this.ay = 0;
      return;
    }

    let vx = (this.x - this.px) * damping;
    let vy = (this.y - this.py) * damping;

    let newX = this.x + vx + this.ax * dt * dt;
    let newY = this.y + vy + this.ay * dt * dt;

    this.px = this.x;
    this.py = this.y;
    this.x = newX;
    this.y = newY;
    this.ax = 0;
    this.ay = 0;
  }
}

class Link {
  constructor(a, b, stiffness = 0.25, restMultiplier = 0.95) {
    this.a = a;
    this.b = b;
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

    // Calculate initial distance between outer nodes
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    this.restDistance = Math.hypot(dx, dy);
  }

  satisfy() {
    // Maintain distance between outer nodes to prevent bending
    const dx = this.c.x - this.a.x;
    const dy = this.c.y - this.a.y;
    const currentDist = Math.hypot(dx, dy) || 1e-6;

    const diff = (currentDist - this.restDistance) / currentDist;
    const correction = diff * this.stiffness * 0.25;

    const correctionX = dx * correction;
    const correctionY = dy * correction;

    // Only apply if both outer nodes are free
    if (!this.a.pinned && !this.c.pinned) {
      this.a.x += correctionX * 0.5;
      this.a.y += correctionY * 0.5;
      this.c.x -= correctionX * 0.5;
      this.c.y -= correctionY * 0.5;
    }
  }
}

// Export for use in other modules or browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Mesh, Node, Link, AngleConstraint };
}