import xml.etree.ElementTree as ET

NS = 'http://www.topografix.com/GPX/1/1'
ET.register_namespace('', NS)
ET.register_namespace('xsi', 'http://www.w3.org/2001/XMLSchema-instance')

GPX = 't808746431_k78-78.2-km.gpx'

checkpoints = {
    0:    'Start',
    716:  'Au',
    1943: 'Trin Digg',
    2953: 'Tegia sut',
    4580: 'Bargis',
    4900: 'Tegia Gronda',
    5909: 'Segneshütte',
    6030: 'Nagens',
    6250: 'Plaun Cumin',
    7872: 'Plaun Station',
    8250: 'Stenna Center',
    8733: 'Ziel',
}

tree = ET.parse(GPX)
root = tree.getroot()
trkseg = root.find(f'{{{NS}}}trk').find(f'{{{NS}}}trkseg')
pts = list(trkseg)

for idx, name in checkpoints.items():
    pt = pts[idx]
    name_el = ET.SubElement(pt, f'{{{NS}}}name')
    name_el.text = name
   # pt.text = "\n    "       # newline + 2 spaces before <name>
    pt[0].tail = pt.tail+"  "
    name_el.tail = "\n      "  # newline + 2 spaces before <ele>


tree.write(GPX, xml_declaration=True, encoding='UTF-8')
print(f'Done — tagged {len(checkpoints)} checkpoints.')
