export function initMap(trackPoints, checkPoints, color) {
    const map = L.map('map');

    const route = L.polyline(
        trackPoints.map(p => [p.lat, p.lon]),
        { color, opacity: 0.6, weight: 5 }
    ).addTo(map);

    for (const cp of checkPoints) {
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
        radius: 10, color, fillColor: color, fillOpacity: 0.2, weight: 2
    });

    return { map, highlight };
}
