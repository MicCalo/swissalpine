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

    return { map, highlight, actualPosition, actualRoutePoly };
}
