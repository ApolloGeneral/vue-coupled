import {
  shallowRef,
  reactive,
  computed,
  provide,
  inject,
  getCurrentInstance,
  onBeforeUnmount,
  onUnmounted,
  onUpdated,
  type Ref,
  type InjectionKey,
  type VNode,
} from 'vue'
import { find, walk, getId, shallowEqual } from './utils'

type ChildId = number
type MaybeRef<T> = T | Ref<T>

type ParentContext<Child> = {
  addChild: (id: ChildId, child: Child) => void
  removeChild: (id: ChildId) => void
  children: Ref<Child[]>
  unmounting: Ref<boolean>
}

export function createCoupled<
  Child extends MaybeRef<Record<string, unknown>>
>() {
  const parentKey = Symbol('parent') as InjectionKey<ParentContext<Child>>
  const childKey = Symbol('child') as InjectionKey<ChildId>

  function useParent() {
    const instance = getCurrentInstance()

    if (!instance) {
      throw new Error('`useParent` must be called within a setup function.')
    }

    const childrenMap = reactive(new Map<ChildId, Child>())

    function addChild(id: ChildId, child: Child) {
      childrenMap.set(id, child)
    }

    function removeChild(id: ChildId) {
      childrenMap.delete(id)
    }

    function getChildrenFromIds(ids: ChildId[]) {
      return ids.map((id) => {
        const child = childrenMap.get(id)

        if (!child) {
          throw new Error(`Child (id: ${id}) is not found.`)
        }

        return child
      })
    }

    function findAllChildrenIds(root: VNode) {
      // This is a current limitation that we only look for children
      // inside the default slot outlet produced by the internal
      // `renderSlot` render helper, which will wrap the default slot
      // into a fragment with key value `_default`.
      // For tempalte `<slot></slot>` outlets this is the current compiled
      // usage.
      // But for parent components using render functions, we need to
      // guarantee that the default slot is rendered with `renderSlot`.
      const defaultSlot = find(root, ({ key }) => key === '_default')

      if (!defaultSlot) {
        return []
      }

      const childIds: ChildId[] = []

      walk(
        defaultSlot,
        ({ component }) => {
          if (!component) {
            return
          }

          // `provides` is now hidden from types 🤫
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore-next-line
          const id = component.provides[childKey]

          if (id != null) {
            childIds.push(id)
          }
        },
        true
      )

      return childIds
    }

    const items = shallowRef<Child[] | null>(null)
    let itemIds: ChildId[] | null = null

    const children = computed(() => {
      // initial render: use registered order
      // subsequent render: use subtree order
      return items.value || getChildrenFromIds(Array.from(childrenMap.keys()))
    })

    onUpdated(() => {
      const ids = findAllChildrenIds(instance.subTree)

      // shallowEqual is crucial here to avoid infinite recursion
      if (shallowEqual(ids, itemIds)) {
        return
      }

      items.value = getChildrenFromIds(ids)
      itemIds = ids
    })

    const unmounting = shallowRef(false)

    onBeforeUnmount(() => {
      unmounting.value = true
    })

    provide(parentKey, {
      addChild,
      removeChild,
      unmounting,
      children,
    })

    return {
      children,
    }
  }

  function useChild(child: Child) {
    const id = getId()

    provide(childKey, id)

    const parent = inject(parentKey)

    if (!parent) {
      throw new Error('No coupled parent found.')
    }

    const { addChild, removeChild, unmounting } = parent

    addChild(id, child)

    onUnmounted(() => {
      if (unmounting.value) {
        return
      }

      removeChild(id)
    })
  }

  return {
    useParent,
    useChild,
  }
}
