import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { PaneStripGlyph, PaneTab, PaneTabLabel, PaneTabStrip } from '../../src/components/ui/pane-tab'
import { Tabs, TabsList, TabsTrigger } from '../../src/components/ui/tabs'
import { TextTab } from '../../src/components/ui/text-tab'
import '../../src/styles.css'

function TabTargets() {
  const [tabs, setTabs] = useState(['One', 'Two', 'Three'])
  const [active, setActive] = useState('One')
  return (
    <>
      <div style={{ width: 120 }}>
        <PaneTabStrip>
          {tabs.map(tab => (
            <PaneTab
              active={active === tab}
              key={tab}
              onClose={() => setTabs(tabs.filter(value => value !== tab))}
              role="tab"
            >
              <PaneTabLabel as="button" onClick={() => setActive(tab)}>
                {tab}
              </PaneTabLabel>
            </PaneTab>
          ))}
          <PaneStripGlyph icon="+" label="Add tab" onSelect={() => setTabs([...tabs, 'Four'])} />
        </PaneTabStrip>
      </div>
      <TextTab>Shared text tab</TextTab>
      <Tabs defaultValue="a">
        <TabsList style={{ width: 140 }}>
          <TabsTrigger value="a">First shared tab</TabsTrigger>
          <TabsTrigger value="b">Second shared tab</TabsTrigger>
        </TabsList>
      </Tabs>
      <div style={{ width: 28 }}>
        <PaneTab vertical onClose={() => undefined}>
          <PaneTabLabel>Vertical</PaneTabLabel>
        </PaneTab>
      </div>
    </>
  )
}

createRoot(document.getElementById('root')).render(<TabTargets />)
