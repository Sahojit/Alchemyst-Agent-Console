/**
 * Array-backed binary min-heap of numbers.
 * Used by SequenceBuffer to find the lowest buffered seq in O(1)
 * with O(log n) insert/remove — cheaper than keeping a sorted array
 * under chaos-mode bursts.
 */
export class MinHeap {
  private items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  peek(): number | undefined {
    return this.items[0];
  }

  push(value: number): void {
    const items = this.items;
    items.push(value);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentValue = items[parent];
      if (parentValue === undefined || parentValue <= value) break;
      items[i] = parentValue;
      i = parent;
    }
    items[i] = value;
  }

  pop(): number | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length === 0 || last === undefined) return top;

    // Sift the former last element down from the root.
    let i = 0;
    const size = items.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      let smallestValue = last;

      const leftValue = left < size ? items[left] : undefined;
      if (leftValue !== undefined && leftValue < smallestValue) {
        smallest = left;
        smallestValue = leftValue;
      }
      const rightValue = right < size ? items[right] : undefined;
      if (rightValue !== undefined && rightValue < smallestValue) {
        smallest = right;
        smallestValue = rightValue;
      }
      if (smallest === i) break;
      items[i] = smallestValue;
      i = smallest;
    }
    items[i] = last;
    return top;
  }
}
