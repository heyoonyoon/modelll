// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { RoomContext } from '../collab/hooks';
import { makeTestRoom } from '../relational/testRoom';
import { ui, useUi } from '../state/ui';
import { DiagramInfo } from './DiagramInfo';

beforeEach(() => useUi.getState().reset());

describe('DiagramInfo', () => {
  it('제목, 개수, 보기 토글, 검증 결과를 보여 준다', () => {
    const room = makeTestRoom();
    render(
      <RoomContext.Provider value={room}>
        <DiagramInfo />
      </RoomContext.Provider>,
    );
        expect(screen.getByTestId('issues-empty')).toBeTruthy();

    const grid = screen.getByTestId('toggle-grid');
    expect(grid.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(grid);
    expect(ui().showGrid).toBe(false);
    expect(grid.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByTestId('toggle-snap'));
    expect(ui().snapEnabled).toBe(false);
    fireEvent.click(screen.getByTestId('toggle-minimap'));
    expect(ui().panels.minimap).toBe(false);
  });
});
