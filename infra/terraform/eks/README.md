# EKS infrastructure (Terraform)

Creates a production-shaped AWS environment for the uptime platform:

- **VPC** across 3 AZs: private subnets for nodes, public subnets for load balancers, one NAT gateway
- **EKS** cluster with managed node group (Spot by default), core add-ons and the EBS CSI driver (for the Postgres volume) using EKS Pod Identity
- **Argo CD** and **Kyverno** installed with Helm, ready for `deploy/argocd` and `deploy/policies`

> ⚠️ **This costs real money** (~$0.10/h for the EKS control plane + NAT gateway + nodes, roughly $5–6 per day).
> CI only runs `fmt` / `validate` / security scanning; nothing is ever applied automatically.
> Always `terraform destroy` when you are done.

## Usage

```bash
cd infra/terraform/eks
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
$(terraform output -raw configure_kubectl)
kubectl apply -f ../../../deploy/policies/
kubectl apply -f ../../../deploy/argocd/application.yaml
```

Tear down:

```bash
terraform destroy
```

For shared/team use, enable the S3 backend in `backend.tf` so state is remote and locked.
