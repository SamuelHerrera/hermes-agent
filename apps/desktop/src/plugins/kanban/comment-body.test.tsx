import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { KanbanCommentBody } from './comment-body'

describe('KanbanCommentBody', () => {
  it('renders pasted attachment image markdown as an inline image while preserving text', () => {
    render(<KanbanCommentBody body={'screenshot context\n\n![clip.png](/api/plugins/kanban/attachments/7)'} />)

    expect(screen.getByText('screenshot context')).toBeTruthy()
    const image = screen.getByRole('img', { name: 'clip.png' }) as HTMLImageElement
    expect(image.getAttribute('src')).toBe('/api/plugins/kanban/attachments/7')
    expect(image.getAttribute('loading')).toBe('lazy')
  })

  it('leaves arbitrary markdown image syntax as text instead of rendering remote images', () => {
    render(<KanbanCommentBody body={'![tracker](https://example.test/tracker.png)'} />)

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('![tracker](https://example.test/tracker.png)')).toBeTruthy()
  })

  it('renders backend-qualified kanban attachment URLs as inline images', () => {
    render(<KanbanCommentBody body={'![clip.png](http://127.0.0.1:8765/api/plugins/kanban/attachments/7?board=ops)'} />)

    const image = screen.getByRole('img', { name: 'clip.png' }) as HTMLImageElement
    expect(image.getAttribute('src')).toBe('http://127.0.0.1:8765/api/plugins/kanban/attachments/7?board=ops')
  })

  it('formats structured review handoff comments instead of showing raw JSON', () => {
    const { container } = render(
      <KanbanCommentBody
        body={
          'review-required handoff:\n' +
          JSON.stringify(
            {
              changed_files: ['apps/desktop/src/plugins/kanban/drawer.tsx'],
              commit: '561f43867',
              tests_run: ['npm run test:ui -- src/plugins/kanban/drawer.test.tsx (19 passed)'],
              verification: ['git diff --check clean'],
              notes: ['Discussion tab was already removed by prior local change.'],
            },
            null,
            2
          )
        }
      />
    )

    expect(screen.getByText('review-required handoff:')).toBeTruthy()
    expect(screen.getByText('Changed files')).toBeTruthy()
    expect(screen.getByText('apps/desktop/src/plugins/kanban/drawer.tsx')).toBeTruthy()
    expect(screen.getByText('Commit')).toBeTruthy()
    expect(screen.getByText('561f43867')).toBeTruthy()
    expect(screen.getByText('Tests run')).toBeTruthy()
    expect(screen.getByText('npm run test:ui -- src/plugins/kanban/drawer.test.tsx (19 passed)')).toBeTruthy()
    expect(container.textContent).not.toContain('"changed_files"')
  })
})
