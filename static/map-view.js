export function initMap(trackPoints, checkPoints, actualPoints, color) {
    const map = L.map('map');

    const route = L.polyline(
        trackPoints.map(p => [p.lat, p.lon]),
        { color, opacity: 0.6, weight: 5 }
    ).addTo(map);

    const actualRoutePoly = L.polyline(
        actualPoints.map(p => [p.lat, p.lon]),
        {color: 'blue'}
    ).addTo(map);

    for (const cp of checkPoints) {
        if (cp.hidden) { continue; }
        
        L.circleMarker([cp.lat, cp.lon], {
            radius: 6, color, fillColor: color, fillOpacity: 0.7, weight: 2
        })
        .bindTooltip(cp.name, { permanent: true, direction: 'top', className: 'map-cp-label', opacity: 1 })
        .addTo(map);
    }

    L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', {
        maxZoom: 18,
        attribution: '&copy; swisstopo'
    }).addTo(map);

    map.fitBounds(route.getBounds());

    const highlight = L.circleMarker([0, 0], {
        radius: 15, color, fillColor: color, fillOpacity: 0.2, weight: 2
    });
    
    const actualPosition = L.circleMarker([0, 0], {
        radius: 20, color: 'blue', fillColor: 'blue', fillOpacity: 0.2, weight: 2
    });

    if (actualPoints.length > 0){
        const last = actualPoints[actualPoints.length - 1]
        actualPosition.setLatLng([last.lat, last.lon]).addTo(map);
    }

    // Bottom-of-map control: center/zoom to the live position, plus a
    // checkbox to keep the map continuously centered as pings come in.
    let autoPanActualPositionCheckbox;
    let autoPanChartPositionCheckbox;
    const PositionControl = L.Control.extend({
        options: { position: 'bottomleft' },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'map-position-control');
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);

            const btn = L.DomUtil.create('button', '', container);
            btn.type = 'button';
            btn.textContent = '\u{1F4CD} Center on position';
            btn.addEventListener('click', () => {
                if (map.hasLayer(actualPosition)) {
                    map.setView(actualPosition.getLatLng(), Math.max(map.getZoom(), 15), { animate: true });
                }
            });

            const label1 = L.DomUtil.create('label', '', container);
            autoPanActualPositionCheckbox = L.DomUtil.create('input', '', label1);
            autoPanActualPositionCheckbox.type = 'checkbox';
            label1.appendChild(document.createTextNode(' Auto-pan on position'));
            autoPanActualPositionCheckbox.addEventListener('change', () => {
                if (autoPanActualPositionCheckbox.checked) autoPanChartPositionCheckbox.checked = false;
            });

            const label2 = L.DomUtil.create('label', '', container);
            autoPanChartPositionCheckbox = L.DomUtil.create('input', '', label2);
            autoPanChartPositionCheckbox.type = 'checkbox';
            label2.appendChild(document.createTextNode(' Auto-pan on height profile'));
            autoPanChartPositionCheckbox.addEventListener('change', () => {
                if (autoPanChartPositionCheckbox.checked) autoPanActualPositionCheckbox.checked = false;
            });

            return container;
        }
    });
    map.addControl(new PositionControl());

    return {
        map, highlight, actualPosition, actualRoutePoly,
        routeBounds: route.getBounds(),
        isAutoPanActualPositionEnabled: () => autoPanActualPositionCheckbox.checked,
        isAutoPanChartPositionEnabled: () => autoPanChartPositionCheckbox.checked
    };
}
