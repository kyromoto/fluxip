import type { Component, ComponentProps } from "solid-js"
import { splitProps } from "solid-js"

import { A } from "@solidjs/router"

import { cn } from "~/lib/cn"

const Breadcrumb: Component<ComponentProps<"nav">> = (props) => {
  const [local, others] = splitProps(props, ["class"])
  return <nav aria-label="breadcrumb" class={local.class} {...others} />
}

const BreadcrumbList: Component<ComponentProps<"ol">> = (props) => {
  const [local, others] = splitProps(props, ["class"])
  return (
    <ol
      class={cn(
        "flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground sm:gap-2",
        local.class
      )}
      {...others}
    />
  )
}

const BreadcrumbItem: Component<ComponentProps<"li">> = (props) => {
  const [local, others] = splitProps(props, ["class"])
  return <li class={cn("inline-flex items-center gap-1.5", local.class)} {...others} />
}

const BreadcrumbLink: Component<ComponentProps<typeof A>> = (props) => {
  const [local, others] = splitProps(props, ["class"])
  return <A class={cn("transition-colors hover:text-foreground", local.class)} {...others} />
}

const BreadcrumbPage: Component<ComponentProps<"span">> = (props) => {
  const [local, others] = splitProps(props, ["class"])
  return (
    <span
      role="link"
      aria-disabled="true"
      aria-current="page"
      class={cn("font-medium text-foreground", local.class)}
      {...others}
    />
  )
}

const BreadcrumbSeparator: Component<ComponentProps<"li">> = (props) => {
  const [local, others] = splitProps(props, ["class", "children"])
  return (
    <li role="presentation" aria-hidden="true" class={cn("text-muted-foreground", local.class)} {...others}>
      {local.children ?? "/"}
    </li>
  )
}

export { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator }
