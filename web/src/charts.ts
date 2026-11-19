export function drawChart(container: HTMLElement, points: { date: string; value: number }[], label: string, bars = false) {
  container.replaceChildren()
  if (!points.length) {
    container.textContent = 'No data for this period.'
    return
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 600 190')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', label)
  svg.classList.add('chart')
  const maximum = Math.max(1, ...points.map(p => p.value))
  const width = 560 / points.length
  const coordinates = points.map((point, index) => ({
    x: 20 + (index + 0.5) * width, y: 160 - point.value / maximum * 140, point
  }))
  if (bars) {
    for (const { x, y, point } of coordinates) {
      const bar = document.createElementNS(svg.namespaceURI, 'rect')
      bar.setAttribute('x', String(x - width * 0.4))
      bar.setAttribute('y', String(y))
      bar.setAttribute('width', String(width * 0.8))
      bar.setAttribute('height', String(Math.max(0, 160 - y)))
      const title = document.createElementNS(svg.namespaceURI, 'title')
      title.textContent = `${point.date}: ${point.value.toLocaleString()}`
      bar.append(title)
      svg.append(bar)
    }
  } else {
    const line = document.createElementNS(svg.namespaceURI, 'polyline')
    line.setAttribute('points', coordinates.map(({ x, y }) => `${x},${y}`).join(' '))
    line.setAttribute('fill', 'none')
    line.setAttribute('stroke', 'currentColor')
    line.setAttribute('stroke-width', '3')
    svg.append(line)
    for (const { x, y, point } of coordinates) {
      const dot = document.createElementNS(svg.namespaceURI, 'circle')
      dot.setAttribute('cx', String(x))
      dot.setAttribute('cy', String(y))
      dot.setAttribute('r', '3')
      const title = document.createElementNS(svg.namespaceURI, 'title')
      title.textContent = `${point.date}: ${point.value.toLocaleString()}`
      dot.append(title)
      svg.append(dot)
    }
  }
  for (const [index, text] of [[0, points[0]!.date], [1, points.at(-1)!.date]] as const) {
    const node = document.createElementNS(svg.namespaceURI, 'text')
    node.setAttribute('x', index ? '580' : '20')
    node.setAttribute('y', '185')
    node.setAttribute('text-anchor', index ? 'end' : 'start')
    node.textContent = text
    svg.append(node)
  }
  container.append(svg)
  const details = document.createElement('details')
  const summary = document.createElement('summary')
  summary.textContent = `${label} · ${points.length} values · maximum ${maximum.toLocaleString()}`
  const table = document.createElement('table')
  const head = table.createTHead().insertRow()
  for (const text of ['Date or day', 'Value']) {
    const th = document.createElement('th')
    th.scope = 'col'
    th.textContent = text
    head.append(th)
  }
  const body = table.createTBody()
  for (const point of points) {
    const row = body.insertRow()
    const date = document.createElement('th')
    date.scope = 'row'
    date.textContent = point.date
    row.append(date)
    row.insertCell().textContent = point.value.toLocaleString(undefined, { maximumFractionDigits: 3 })
  }
  details.append(summary, table)
  container.append(details)
}
