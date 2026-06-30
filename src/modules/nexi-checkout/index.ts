import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import NexiCheckoutProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [NexiCheckoutProviderService],
})

