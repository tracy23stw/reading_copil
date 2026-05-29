/**
 * graph-render.js — D3.js 关系图谱渲染逻辑
 */

// auto-execution removed for SPA architecture

function renderGraph(relationships, characters, families) {
  const container = document.getElementById('graph-container');
  const width = container.clientWidth;
  const height = container.clientHeight;

  const nodesMap = new Map();
  
  characters.forEach(c => {
    nodesMap.set(c.name, {
      id: c.name,
      radius: Math.min(Math.max(c.count / 10, 20), 50),
      summary: c.summary || '暂无简介',
      family: null
    });
  });

  relationships.forEach(r => {
    if (!nodesMap.has(r.source)) nodesMap.set(r.source, { id: r.source, radius: 25, summary: '暂无简介', family: null });
    if (!nodesMap.has(r.target)) nodesMap.set(r.target, { id: r.target, radius: 25, summary: '暂无简介', family: null });
  });

  // 分配家族
  families.forEach(f => {
    f.members.forEach(m => {
      if (nodesMap.has(m)) {
        nodesMap.get(m).family = f.groupName;
      }
    });
  });

  const nodes = Array.from(nodesMap.values());
  const links = relationships.map(r => ({
    source: r.source,
    target: r.target,
    label: r.relation
  }));

  const svg = d3.select('#graph-container')
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .call(d3.zoom().on('zoom', (event) => {
      g.attr('transform', event.transform);
    }));

  const g = svg.append('g');

  // 图层顺序：背景框 -> 背景字 -> 连线 -> 连线字 -> 节点
  const hullGroup = g.append('g').attr('class', 'hulls');
  const hullLabelGroup = g.append('g').attr('class', 'hull-labels');
  
  // 力导向图模拟器
  const simulation = d3.forceSimulation(nodes)
    .velocityDecay(0.8) // 增加摩擦力，减少弹跳
    .force('link', d3.forceLink(links).id(d => d.id)
      .distance(d => (d.source.family === d.target.family && d.source.family !== null) ? 120 : 400)
      .strength(d => (d.source.family === d.target.family && d.source.family !== null) ? 1 : 0.2)
    )
    .force('charge', d3.forceManyBody().strength(-2000)) // 增加斥力，防止线交叉
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide().radius(d => d.radius + 30))
    // 家族聚类力：让同一个家族的人靠拢
    .force('cluster', clusterForce(nodes));

  const link = g.append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('class', 'link-line')
    .attr('stroke-width', 2);

  const linkText = g.append('g')
    .selectAll('text')
    .data(links)
    .join('text')
    .attr('class', 'link-label')
    .attr('dy', -5)
    .text(d => d.label);

  const node = g.append('g')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .call(drag(simulation));

  node.append('circle')
    .attr('class', 'node-circle')
    .attr('r', d => d.radius);

  node.append('text')
    .attr('class', 'node-label')
    .text(d => d.id);

  const tooltip = d3.select('#tooltip');
  
  // 鼠标交互 (桌面端)
  node.on('mouseover', (event, d) => {
    tooltip.style('display', 'block')
      .html(`<h3>${d.id}</h3><p>${d.summary}</p>`);
  }).on('mousemove', (event) => {
    tooltip.style('left', (event.pageX + 15) + 'px')
      .style('top', (event.pageY + 15) + 'px');
  }).on('mouseout', () => {
    tooltip.style('display', 'none');
  });

  // 触控交互 (iPad 等移动端)
  node.on('click', (event, d) => {
    event.stopPropagation(); // 防止点击穿透到 svg 背景
    tooltip.style('display', 'block')
      .html(`<h3>${d.id}</h3><p>${d.summary}</p>`)
      .style('left', (event.pageX + 15) + 'px')
      .style('top', (event.pageY + 15) + 'px');
  });

  // 点击背景隐藏 Tooltip
  svg.on('click', () => {
    tooltip.style('display', 'none');
  });

  const valueline = d3.line().curve(d3.curveCatmullRomClosed);

  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    linkText
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2);

    node
      .attr('transform', d => `translate(${d.x},${d.y})`);
      
    // 计算并绘制家族边框 (Convex Hull)
    drawHulls(nodes, hullGroup, hullLabelGroup, valueline);
  });

  function drag(simulation) {
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }
    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
    return d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended);
  }
}

// 聚类力，拉近同家族节点
function clusterForce(nodes) {
  let strength = 0.2;
  return function(alpha) {
    const centroids = d3.rollup(nodes.filter(n => n.family), 
      v => ({ x: d3.mean(v, d => d.x), y: d3.mean(v, d => d.y) }), 
      d => d.family
    );
    
    for (let d of nodes) {
      if (!d.family) continue;
      const c = centroids.get(d.family);
      if (!c) continue;
      d.vx -= (d.x - c.x) * strength * alpha;
      d.vy -= (d.y - c.y) * strength * alpha;
    }
  };
}

// 绘制包围框
function drawHulls(nodes, hullGroup, hullLabelGroup, valueline) {
  const padding = 45;
  const groups = d3.group(nodes.filter(n => n.family && n.family !== '其他'), d => d.family);
  
  const hullData = Array.from(groups).map(([family, members]) => {
    const points = [];
    members.forEach(m => {
      const r = m.radius + padding;
      points.push([m.x - r, m.y - r]);
      points.push([m.x + r, m.y - r]);
      points.push([m.x + r, m.y + r]);
      points.push([m.x - r, m.y + r]);
    });
    
    const hull = d3.polygonHull(points);
    return { family, path: hull, members };
  }).filter(d => d.path);

  // Path
  hullGroup.selectAll('path')
    .data(hullData, d => d.family)
    .join('path')
    .attr('d', d => valueline(d.path))
    .attr('fill', 'var(--color-bg-folder)')
    .attr('fill-opacity', 0.4)
    .attr('stroke', 'var(--color-border)')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '8,4');
    
  // Label
  hullLabelGroup.selectAll('text')
    .data(hullData, d => d.family)
    .join('text')
    .attr('x', d => d3.mean(d.members, m => m.x))
    .attr('y', d => d3.min(d.members, m => m.y) - 60)
    .attr('text-anchor', 'middle')
    .style('font-family', 'var(--font-serif)')
    .style('font-size', '20px')
    .style('font-weight', 'bold')
    .style('fill', 'var(--color-text-primary)')
    .style('pointer-events', 'none')
    .text(d => d.family);
}
