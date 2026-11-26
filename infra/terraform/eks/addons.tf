# Platform add-ons installed into the new cluster: Argo CD (GitOps) and
# Kyverno (admission policies). After apply, hand over to GitOps with:
#   kubectl apply -f deploy/policies/
#   kubectl apply -f deploy/argocd/application.yaml

provider "helm" {
  kubernetes = {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name, "--region", var.region]
    }
  }
}

resource "helm_release" "argocd" {
  count = var.install_platform_addons ? 1 : 0

  name             = "argocd"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  namespace        = "argocd"
  create_namespace = true
  wait             = true
  timeout          = 600

  depends_on = [module.eks]
}

resource "helm_release" "kyverno" {
  count = var.install_platform_addons ? 1 : 0

  name             = "kyverno"
  repository       = "https://kyverno.github.io/kyverno/"
  chart            = "kyverno"
  namespace        = "kyverno"
  create_namespace = true
  wait             = true
  timeout          = 600

  values = [yamlencode({
    admissionController = { replicas = 3 } # HA: admission webhooks are on the critical path
  })]

  depends_on = [module.eks]
}
